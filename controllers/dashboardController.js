const Client = require('../models/Client');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Invoice = require('../models/Invoice');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { departmentIdsFromUser } = require('../utils/departmentScope');
const { isClientAdmin } = require('../utils/clientScope');
const { buildEmployeeTaskVisibilityOr, participantIdVariants } = require('../utils/taskVisibility');

// @GET /api/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const user = req.user;
    const isAdmin = ['super_admin', 'admin'].includes(user.role);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Base filters by role — non-admins only see their own clients (assigned AM) and related projects/tasks
    const clientFilter = {};
    const projectFilter = {};
    let taskFilter = { deletedAt: null };
    let myClientIds = [];

    if (!isAdmin) {
      myClientIds = await Client.find({
        $or: [{ assignedAM: user._id }, { projectManager: user._id }],
      }).distinct('_id');
      clientFilter.$or = [{ assignedAM: user._id }, { projectManager: user._id }];
      projectFilter.clientId = myClientIds.length ? { $in: myClientIds } : { $in: [] };
      // Tasks: same visibility as /api/tasks — not only "my clients" (employees must see assigned work)
      taskFilter = {
        deletedAt: null,
        $and: [buildEmployeeTaskVisibilityOr(user._id, myClientIds)],
      };
    }

    const idList = participantIdVariants(user._id);
    const myTasksQuery = {
      deletedAt: null,
      status: { $nin: ['done', 'approved'] },
      $or: [
        { assigneeId: { $in: idList } },
        { assigneeIds: { $in: idList } },
        { reviewerId: { $in: idList } },
        { reviewerIds: { $in: idList } },
      ],
    };

    const [
      clientStats, projectStats, taskStats,
      myTasks, recentTasks, notifications, upcomingDeadlines
    ] = await Promise.all([
      // Client stats
      Client.aggregate([
        { $match: clientFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      // Project stats
      Project.aggregate([
        { $match: projectFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      // Task stats
      Task.aggregate([
        { $match: { ...taskFilter, createdAt: { $gte: monthStart } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Task.find(myTasksQuery)
        .populate('projectId', 'title')
        .populate('clientId', 'name company logo')
        .sort({ dueDate: 1, priority: -1 })
        .limit(8)
        .lean(),
      // Recent activity
      Task.find({ ...taskFilter, updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } })
        .populate('assigneeId', 'name avatar')
        .populate('clientId', 'name company')
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
      // Notifications
      Notification.find({ userId: user._id, isRead: false }).sort({ createdAt: -1 }).limit(5).lean(),
      // Upcoming deadlines
      Task.find({
        ...taskFilter,
        status: { $nin: ['done', 'approved'] },
        dueDate: { $gte: now, $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
      })
        .populate('clientId', 'name company')
        .populate('projectId', 'title')
        .sort({ dueDate: 1 })
        .limit(5)
        .lean()
    ]);

    // Financial (admin only)
    let financial = null;
    if (isAdmin) {
      const [revenue, outstanding] = await Promise.all([
        Invoice.aggregate([
          { $match: { status: 'paid', issueDate: { $gte: monthStart } } },
          { $group: { _id: null, total: { $sum: '$total' } } }
        ]),
        Invoice.aggregate([
          { $match: { status: { $in: ['sent', 'viewed', 'overdue'] } } },
          { $group: { _id: null, total: { $sum: { $subtract: ['$total', '$paidAmount'] } } } }
        ])
      ]);
      financial = {
        monthRevenue: revenue[0]?.total || 0,
        outstanding: outstanding[0]?.total || 0
      };
    }

    const mapStats = (arr) => arr.reduce((acc, cur) => { acc[cur._id] = cur.count; return acc; }, {});

    res.json({
      success: true,
      data: {
        clients: mapStats(clientStats),
        projects: mapStats(projectStats),
        tasks: mapStats(taskStats),
        myTasks,
        recentTasks,
        notifications,
        upcomingDeadlines,
        financial,
        user: { name: user.name, role: user.role, department: user.departmentId, departments: departmentIdsFromUser(user) }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/dashboard/health-scores
exports.getHealthScores = async (req, res) => {
  try {
    const filter = !isClientAdmin(req.user)
      ? {
          $and: [
            { status: { $in: ['active', 'at_risk'] } },
            {
              $or: [
                { assignedAM: req.user._id },
                { projectManager: req.user._id },
              ],
            },
          ],
        }
      : { status: { $in: ['active', 'at_risk'] } };

    const clients = await Client.find(filter)
      .select('name company healthScore status assignedAM projectManager renewalDate')
      .populate('assignedAM', 'name avatar')
      .populate('projectManager', 'name avatar')
      .sort({ 'healthScore.overall': 1 })
      .lean();

    const distribution = { green: 0, amber: 0, red: 0 };
    clients.forEach(c => {
      const s = c.healthScore?.overall || 0;
      if (s >= 8) distribution.green++;
      else if (s >= 5) distribution.amber++;
      else distribution.red++;
    });

    res.json({ success: true, clients, distribution });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/dashboard/standup
exports.getStandupData = async (req, res) => {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const filter = { deletedAt: null };
    if (req.scopeDepartments?.length) {
      filter.departmentId =
        req.scopeDepartments.length === 1
          ? req.scopeDepartments[0]
          : { $in: req.scopeDepartments };
    }

    const [completedYesterday, todayTasks, blockers, overdue] = await Promise.all([
      Task.find({ ...filter, status: 'done', updatedAt: { $gte: yesterday } })
        .populate('assigneeId', 'name avatar').limit(20).lean(),
      Task.find({ ...filter, status: 'in_progress', assigneeId: { $exists: true } })
        .populate('assigneeId', 'name avatar')
        .populate('clientId', 'name company').limit(20).lean(),
      Task.find({ ...filter, status: 'blocked' })
        .populate('assigneeId', 'name avatar')
        .populate('clientId', 'name company').lean(),
      Task.find({ ...filter, isDelayed: true, status: { $nin: ['done', 'approved'] } })
        .populate('assigneeId', 'name avatar')
        .populate('clientId', 'name company').limit(10).lean()
    ]);

    res.json({ success: true, data: { completedYesterday, todayTasks, blockers, overdue } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
