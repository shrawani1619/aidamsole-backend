const Project = require('../models/Project');
const Task = require('../models/Task');
const Notification = require('../models/Notification');

// @GET /api/projects
exports.getProjects = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.client) filter.clientId = req.query.client;
    if (req.query.department) filter.departmentId = req.query.department;
    if (req.query.service) filter.service = req.query.service;
    if (req.query.search) filter.title = { $regex: req.query.search, $options: 'i' };

    // RBAC scope
    if (!req.scopeAll) {
      if (req.scopeDepartment) filter.departmentId = req.scopeDepartment;
      if (req.scopeUser) filter.$or = [{ managerId: req.scopeUser }, { team: req.scopeUser }];
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .populate('clientId', 'name company logo status')
        .populate('departmentId', 'name slug color')
        .populate('managerId', 'name email avatar')
        .populate('team', 'name email avatar')
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      Project.countDocuments(filter)
    ]);

    res.json({ success: true, count: projects.length, total, page, pages: Math.ceil(total / limit), projects });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/projects
exports.createProject = async (req, res) => {
  try {
    const project = await Project.create({ ...req.body });
    const populated = await Project.findById(project._id)
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('managerId', 'name email avatar')
      .populate('team', 'name email avatar');

    // Notify team members
    if (req.body.team && req.body.team.length) {
      const notifications = req.body.team.map(userId => ({
        userId,
        type: 'project',
        title: 'Added to Project',
        message: `You have been added to project: ${project.title}`,
        link: `/projects/${project._id}`,
        priority: 'medium'
      }));
      await Notification.insertMany(notifications);
    }

    res.status(201).json({ success: true, project: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/projects/:id
exports.getProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('clientId', 'name company logo status healthScore assignedAM')
      .populate('departmentId', 'name slug color icon')
      .populate('managerId', 'name email avatar phone')
      .populate('team', 'name email avatar role departmentRole');
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    // Task summary
    const taskStats = await Task.aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({ success: true, project, taskStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/projects/:id
exports.updateProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('managerId', 'name email avatar')
      .populate('team', 'name email avatar');
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/projects/:id/milestone
exports.updateMilestone = async (req, res) => {
  try {
    const { milestoneId, completed } = req.body;
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, 'milestones._id': milestoneId },
      {
        $set: {
          'milestones.$.completed': completed,
          'milestones.$.completedDate': completed ? new Date() : null
        }
      },
      { new: true }
    );
    if (!project) return res.status(404).json({ success: false, message: 'Project/Milestone not found' });

    // Recalculate progress
    const completedCount = project.milestones.filter(m => m.completed).length;
    project.progress = project.milestones.length
      ? Math.round((completedCount / project.milestones.length) * 100)
      : 0;
    await project.save();

    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/projects/:id
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    res.json({ success: true, message: 'Project cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/projects/:id/tasks
exports.getProjectTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ projectId: req.params.id })
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
      .sort({ dueDate: 1, priority: -1 })
      .lean();
    res.json({ success: true, count: tasks.length, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
