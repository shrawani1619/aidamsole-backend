const Client = require('../models/Client');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Department = require('../models/Department');
const Report = require('../models/Report');
const { v4: uuidv4 } = require('uuid');
const { hasModuleAction } = require('../utils/modulePermissions');

/** Strip KPI / sections the user is not allowed to see (field-level on dashboard module). */
function filterInsightsPayload(data, resolved) {
  const f = resolved.dashboard?.fields || {};
  const kpis = { ...data.kpis };
  if (f.mrr === false) delete kpis.mrr;
  if (f.activeClients === false) {
    delete kpis.activeClients;
    delete kpis.totalClients;
    delete kpis.churnedClients;
    delete kpis.churnRate;
  }
  if (f.thisMonthRevenue === false) {
    delete kpis.thisMonthRevenue;
    delete kpis.lastMonthRevenue;
    delete kpis.revenueGrowth;
  }
  if (f.delayedTasks === false) {
    delete kpis.delayedTasks;
    delete kpis.taskDelayRate;
  }

  let departments = data.departments;
  if (f.deptPerformance === false) departments = [];

  let topClients = data.topClients;
  let riskClients = data.riskClients;
  if (f.clientHealth === false) {
    topClients = [];
    riskClients = [];
  } else {
    if (f.topClients === false) topClients = [];
    if (f.riskClients === false) riskClients = [];
  }

  let revenueHistory = data.revenueHistory;
  if (f.revenueHistory === false) revenueHistory = [];

  return {
    ...data,
    kpis,
    departments,
    topClients,
    riskClients,
    revenueHistory,
  };
}

// Helper: build date range
const getDateRange = (range, startDate, endDate) => {
  const now = new Date();
  let start, end;
  end = endDate ? new Date(endDate) : new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (range) {
    case 'daily':
      start = startDate ? new Date(startDate) : new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      start = startDate ? new Date(startDate) : new Date(now);
      if (!startDate) { start.setDate(start.getDate() - 7); }
      start.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
      if (!startDate) start.setHours(0, 0, 0, 0);
      break;
    case 'yearly':
      start = startDate ? new Date(startDate) : new Date(now.getFullYear(), 0, 1);
      if (!startDate) start.setHours(0, 0, 0, 0);
      break;
    case 'custom':
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { start, end };
};

// ─── FINANCIAL REPORT ─────────────────────────────────────────────────────────
exports.getFinancialReport = async (req, res) => {
  try {
    const { range = 'monthly', startDate, endDate } = req.query;
    const { start, end } = getDateRange(range, startDate, endDate);

    const [invoices, allInvoices, clients] = await Promise.all([
      Invoice.find({ issueDate: { $gte: start, $lte: end } })
        .populate('clientId', 'name company contractValue'),
      Invoice.find({ status: 'overdue' }).populate('clientId', 'name company'),
      Client.find({ status: 'active' })
    ]);

    // Core metrics
    const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
    const totalBilled = invoices.reduce((s, i) => s + i.total, 0);
    const outstanding = invoices.filter(i => ['sent', 'viewed', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.total - i.paidAmount), 0);
    const overdueAmount = allInvoices.reduce((s, i) => s + (i.total - i.paidAmount), 0);

    // MRR: sum of all active client contracts
    const mrr = clients.reduce((s, c) => s + (c.contractValue || 0), 0);

    // Monthly breakdown for chart
    const monthlyData = {};
    invoices.forEach(inv => {
      const key = `${new Date(inv.issueDate).getFullYear()}-${String(new Date(inv.issueDate).getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyData[key]) monthlyData[key] = { revenue: 0, billed: 0 };
      if (inv.status === 'paid') monthlyData[key].revenue += inv.total;
      monthlyData[key].billed += inv.total;
    });

    // Revenue by service
    const serviceMap = {};
    invoices.forEach(inv => {
      inv.lineItems.forEach(item => {
        const svc = item.service || 'Other';
        serviceMap[svc] = (serviceMap[svc] || 0) + item.total;
      });
    });

    // Client-wise profitability
    const clientRevMap = {};
    invoices.filter(i => i.status === 'paid').forEach(inv => {
      if (!inv.clientId) return;
      const cid = String(inv.clientId._id);
      if (!clientRevMap[cid]) clientRevMap[cid] = { client: inv.clientId, revenue: 0, invoiceCount: 0 };
      clientRevMap[cid].revenue += inv.total;
      clientRevMap[cid].invoiceCount++;
    });
    const clientProfitability = Object.values(clientRevMap).sort((a, b) => b.revenue - a.revenue);

    const data = {
      summary: {
        totalRevenue,
        totalBilled,
        outstanding,
        overdueAmount,
        mrr,
        collectionRate: totalBilled > 0 ? Math.round((totalRevenue / totalBilled) * 100) : 0,
        invoiceCount: invoices.length,
        paidInvoices: invoices.filter(i => i.status === 'paid').length
      },
      monthly: Object.entries(monthlyData).sort(([a], [b]) => a.localeCompare(b)).map(([month, vals]) => ({ month, ...vals })),
      byService: Object.entries(serviceMap).map(([service, amount]) => ({ service, amount })).sort((a, b) => b.amount - a.amount),
      topClients: clientProfitability.slice(0, 10),
      overdueInvoices: allInvoices.slice(0, 10),
      range: { start, end }
    };

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CLIENT PERFORMANCE REPORT ────────────────────────────────────────────────
exports.getClientPerformanceReport = async (req, res) => {
  try {
    const { range = 'monthly', startDate, endDate, clientId, department } = req.query;
    const { start, end } = getDateRange(range, startDate, endDate);

    const clientFilter = { status: { $in: ['active', 'at_risk'] } };
    if (clientId) clientFilter._id = clientId;
    if (department) clientFilter.assignedDepartments = department;

    // RBAC
    if (!req.scopeAll) {
      if (req.scopeDepartments?.length) {
        clientFilter.assignedDepartments =
          req.scopeDepartments.length === 1
            ? req.scopeDepartments[0]
            : { $in: req.scopeDepartments };
      } else if (req.scopeUser) {
        clientFilter.$or = [
          { assignedAM: req.scopeUser },
          { projectManager: req.scopeUser },
        ];
      }
    }

    const clients = await Client.find(clientFilter)
      .populate('assignedAM', 'name email avatar')
      .populate('assignedDepartments', 'name slug color')
      .lean();

    // Health score distribution
    const healthDist = { green: 0, amber: 0, red: 0 };
    const atRiskClients = [];
    const upcomingRenewals = [];

    clients.forEach(c => {
      const score = c.healthScore?.overall || 0;
      if (score >= 8) healthDist.green++;
      else if (score >= 5) healthDist.amber++;
      else { healthDist.red++; atRiskClients.push(c); }

      const renewal = c.renewalDate ? new Date(c.renewalDate) : null;
      if (renewal) {
        const daysToRenewal = Math.ceil((renewal - new Date()) / (1000 * 60 * 60 * 24));
        if (daysToRenewal >= 0 && daysToRenewal <= 30) upcomingRenewals.push({ ...c, daysToRenewal });
      }
    });

    // Tasks per client in range
    const tasks = await Task.find({
      ...(clientId ? { clientId } : {}),
      createdAt: { $gte: start, $lte: end },
      deletedAt: null,
    }).lean();

    const tasksByClient = {};
    tasks.forEach(t => {
      const cid = String(t.clientId);
      if (!tasksByClient[cid]) tasksByClient[cid] = { total: 0, done: 0, delayed: 0 };
      tasksByClient[cid].total++;
      if (t.status === 'done') tasksByClient[cid].done++;
      if (t.isDelayed) tasksByClient[cid].delayed++;
    });

    const data = {
      summary: {
        totalClients: clients.length,
        healthDistribution: healthDist,
        avgHealthScore: clients.length ? (clients.reduce((s, c) => s + (c.healthScore?.overall || 0), 0) / clients.length).toFixed(1) : 0,
        atRiskCount: healthDist.red,
        renewalsDue: upcomingRenewals.length
      },
      clients: clients.map(c => ({
        ...c,
        taskStats: tasksByClient[String(c._id)] || { total: 0, done: 0, delayed: 0 }
      })),
      atRiskClients: atRiskClients.slice(0, 10),
      upcomingRenewals: upcomingRenewals.sort((a, b) => a.daysToRenewal - b.daysToRenewal).slice(0, 10),
      range: { start, end }
    };

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── TEAM PERFORMANCE REPORT ──────────────────────────────────────────────────
exports.getTeamPerformanceReport = async (req, res) => {
  try {
    const { range = 'monthly', startDate, endDate, department, userId } = req.query;
    const { start, end } = getDateRange(range, startDate, endDate);

    const taskFilter = { createdAt: { $gte: start, $lte: end }, deletedAt: null };
    if (department) taskFilter.departmentId = department;
    if (userId) taskFilter.assigneeId = userId;
    if (!req.scopeAll && req.scopeDepartments?.length) {
      taskFilter.departmentId =
        req.scopeDepartments.length === 1
          ? req.scopeDepartments[0]
          : { $in: req.scopeDepartments };
    }

    const tasks = await Task.find(taskFilter)
      .populate('assigneeId', 'name email avatar')
      .populate('departmentId', 'name slug color')
      .populate('clientId', 'name company logo')
      .populate('projectId', 'title service')
      .sort({ updatedAt: -1 })
      .lean();

    // Per-user stats
    const userStats = {};
    tasks.forEach(t => {
      if (!t.assigneeId) return;
      const uid = String(t.assigneeId._id);
      if (!userStats[uid]) {
        userStats[uid] = {
          user: t.assigneeId,
          department: t.departmentId,
          total: 0, completed: 0, delayed: 0,
          onTime: 0, totalHours: 0, revisions: 0
        };
      }
      userStats[uid].total++;
      if (t.status === 'done' || t.status === 'approved') userStats[uid].completed++;
      if (t.isDelayed) userStats[uid].delayed++;
      else if (t.status === 'done') userStats[uid].onTime++;
      userStats[uid].totalHours += t.actualHours || 0;
      userStats[uid].revisions += t.revisionCount || 0;
    });

    const teamData = Object.values(userStats).map(u => ({
      ...u,
      completionRate: u.total > 0 ? Math.round((u.completed / u.total) * 100) : 0,
      onTimeRate: u.completed > 0 ? Math.round((u.onTime / u.completed) * 100) : 0,
      productivityScore: Math.min(100, Math.round(
        ((u.completed / Math.max(u.total, 1)) * 60) +
        ((1 - Math.min(u.delayed / Math.max(u.total, 1), 1)) * 40)
      ))
    })).sort((a, b) => b.productivityScore - a.productivityScore);

    // Department-level rollup
    const deptStats = {};
    tasks.forEach(t => {
      if (!t.departmentId) return;
      const did = String(t.departmentId._id);
      if (!deptStats[did]) deptStats[did] = { dept: t.departmentId, total: 0, done: 0, delayed: 0 };
      deptStats[did].total++;
      if (t.status === 'done' || t.status === 'approved') deptStats[did].done++;
      if (t.isDelayed) deptStats[did].delayed++;
    });

    const data = {
      summary: {
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => ['done', 'approved'].includes(t.status)).length,
        delayedTasks: tasks.filter(t => t.isDelayed).length,
        overallCompletionRate: tasks.length ? Math.round((tasks.filter(t => ['done', 'approved'].includes(t.status)).length / tasks.length) * 100) : 0,
        totalHoursLogged: tasks.reduce((s, t) => s + (t.actualHours || 0), 0).toFixed(1)
      },
      team: teamData,
      departments: Object.values(deptStats),
      range: { start, end }
    };

    if (userId) {
      const employee = await User.findById(userId)
        .select('name email role departmentRole departmentId departmentMemberships lastLogin avatar phone isActive')
        .populate('departmentId', 'name slug color')
        .populate('departmentMemberships.departmentId', 'name slug color')
        .lean();
      const tasksByStatus = {};
      tasks.forEach(t => {
        tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
      });
      const projectIds = new Set();
      tasks.forEach(t => {
        if (t.projectId?._id) projectIds.add(String(t.projectId._id));
      });
      const memberRow = teamData.find(t => String(t.user?._id) === String(userId)) || null;
      data.employee = employee;
      data.memberMetrics = memberRow;
      data.tasksByStatus = tasksByStatus;
      data.distinctProjectCount = projectIds.size;
      data.recentTasks = tasks.slice(0, 50).map(t => ({
        _id: t._id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        isDelayed: t.isDelayed,
        actualHours: t.actualHours || 0,
        clientId: t.clientId,
        projectId: t.projectId,
        departmentId: t.departmentId
      }));
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── OPERATIONAL REPORT ───────────────────────────────────────────────────────
exports.getOperationalReport = async (req, res) => {
  try {
    const { range = 'monthly', startDate, endDate, department } = req.query;
    const { start, end } = getDateRange(range, startDate, endDate);

    const projectFilter = { createdAt: { $gte: start, $lte: end } };
    const taskFilter = { createdAt: { $gte: start, $lte: end }, deletedAt: null };
    if (department) { projectFilter.departmentId = department; taskFilter.departmentId = department; }
    if (!req.scopeAll && req.scopeDepartments?.length) {
      const scoped =
        req.scopeDepartments.length === 1
          ? req.scopeDepartments[0]
          : { $in: req.scopeDepartments };
      projectFilter.departmentId = scoped;
      taskFilter.departmentId = scoped;
    }

    const [projects, tasks, departments] = await Promise.all([
      Project.find(projectFilter).populate('clientId', 'name company').populate('departmentId', 'name slug color').lean(),
      Task.find(taskFilter).populate('assigneeId', 'name email avatar').lean(),
      Department.find({ isActive: true }).lean()
    ]);

    // Workload distribution
    const workloadMap = {};
    tasks.forEach(t => {
      if (!t.assigneeId) return;
      const uid = String(t.assigneeId._id);
      if (!workloadMap[uid]) workloadMap[uid] = { user: t.assigneeId, count: 0 };
      if (!['done', 'approved'].includes(t.status)) workloadMap[uid].count++;
    });

    const data = {
      summary: {
        totalProjects: projects.length,
        activeProjects: projects.filter(p => p.status === 'active').length,
        completedProjects: projects.filter(p => p.status === 'completed').length,
        delayedProjects: projects.filter(p => p.dueDate && new Date(p.dueDate) < new Date() && p.status !== 'completed').length,
        totalTasks: tasks.length,
        pendingTasks: tasks.filter(t => !['done', 'approved'].includes(t.status)).length,
        delayedTasks: tasks.filter(t => t.isDelayed).length,
        avgTaskCompletionTime: (() => {
          const done = tasks.filter(t => t.completedAt && t.createdAt);
          if (!done.length) return 0;
          const avg = done.reduce((s, t) => s + (new Date(t.completedAt) - new Date(t.createdAt)), 0) / done.length;
          return Math.round(avg / (1000 * 60 * 60 * 24));
        })()
      },
      projectsByStatus: ['planning', 'active', 'on_hold', 'completed', 'cancelled'].map(status => ({
        status, count: projects.filter(p => p.status === status).length
      })),
      tasksByStatus: ['todo', 'in_progress', 'review', 'approved', 'done', 'blocked'].map(status => ({
        status, count: tasks.filter(t => t.status === status).length
      })),
      workloadDistribution: Object.values(workloadMap).sort((a, b) => b.count - a.count),
      projects,
      range: { start, end }
    };

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN DASHBOARD INSIGHTS ──────────────────────────────────────────
exports.getSuperAdminInsights = async (req, res) => {
  try {
    const resolved = req.effectiveModulePermissions;
    if (!hasModuleAction(resolved, 'dashboard', 'view')) {
      return res.status(403).json({ success: false, message: 'No access to dashboard insights' });
    }

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      clients, activeClients, churned, departments, users,
      thisMonthInvoices, lastMonthInvoices, openTasks, delayedTasks
    ] = await Promise.all([
      Client.countDocuments(),
      Client.countDocuments({ status: 'active' }),
      Client.countDocuments({ status: 'churned' }),
      Department.find({ isActive: true }).populate('members', '_id'),
      User.countDocuments({ isActive: true, deletedAt: null }),
      Invoice.find({ issueDate: { $gte: thisMonthStart }, status: 'paid' }),
      Invoice.find({ issueDate: { $gte: lastMonthStart, $lte: lastMonthEnd }, status: 'paid' }),
      Task.countDocuments({ status: { $nin: ['done', 'approved'] }, deletedAt: null }),
      Task.countDocuments({ isDelayed: true, deletedAt: null })
    ]);

    const mrr = await Client.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$contractValue' } } }
    ]);

    const thisMonthRev = thisMonthInvoices.reduce((s, i) => s + i.total, 0);
    const lastMonthRev = lastMonthInvoices.reduce((s, i) => s + i.total, 0);
    const revenueGrowth = lastMonthRev > 0 ? (((thisMonthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1) : 0;

    // Dept performance
    const deptPerf = await Promise.all(departments.map(async dept => {
      const memberIds = dept.members.map(m => m._id);
      const [deptTasks, deptDelayed] = await Promise.all([
        Task.countDocuments({ departmentId: dept._id, deletedAt: null }),
        Task.countDocuments({ departmentId: dept._id, isDelayed: true, deletedAt: null })
      ]);
      return {
        _id: dept._id, name: dept.name, color: dept.color,
        members: memberIds.length,
        tasks: deptTasks,
        delayed: deptDelayed,
        efficiency: deptTasks > 0 ? Math.round(((deptTasks - deptDelayed) / deptTasks) * 100) : 100
      };
    }));

    // Top/bottom clients by health
    const allClients = await Client.find({ status: { $in: ['active', 'at_risk'] } })
      .select('name company healthScore contractValue assignedAM status')
      .populate('assignedAM', 'name')
      .sort({ 'healthScore.overall': -1 })
      .lean();

    // 12-month revenue trend
    const revenueHistory = await Invoice.aggregate([
      { $match: { status: 'paid', issueDate: { $gte: new Date(now.getFullYear() - 1, now.getMonth(), 1) } } },
      { $group: { _id: { year: { $year: '$issueDate' }, month: { $month: '$issueDate' } }, revenue: { $sum: '$total' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const rawData = {
      kpis: {
        totalClients: clients,
        activeClients,
        churnedClients: churned,
        churnRate: clients > 0 ? ((churned / clients) * 100).toFixed(1) : 0,
        mrr: mrr[0]?.total || 0,
        thisMonthRevenue: thisMonthRev,
        lastMonthRevenue: lastMonthRev,
        revenueGrowth: parseFloat(revenueGrowth),
        totalUsers: users,
        openTasks,
        delayedTasks,
        taskDelayRate: openTasks > 0 ? Math.round((delayedTasks / openTasks) * 100) : 0
      },
      departments: deptPerf,
      topClients: allClients.slice(0, 5),
      riskClients: allClients.filter(c => (c.healthScore?.overall || 0) < 5).slice(0, 5),
      revenueHistory
    };

    const data =
      ['super_admin', 'admin'].includes(req.user.role)
        ? rawData
        : filterInsightsPayload(rawData, resolved);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GENERATE SHAREABLE LINK ──────────────────────────────────────────────────
exports.generateShareLink = async (req, res) => {
  try {
    const { type, range, filters, data } = req.body;
    const shareToken = uuidv4();
    await Report.create({
      type, range, filters, data,
      generatedBy: req.user._id,
      shareToken,
      cacheExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });
    res.json({ success: true, shareToken, link: `${process.env.FRONTEND_URL}/reports/shared/${shareToken}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/reports/shared/:token
exports.getSharedReport = async (req, res) => {
  try {
    const report = await Report.findOne({
      shareToken: req.params.token,
      cacheExpiry: { $gte: new Date() }
    }).populate('generatedBy', 'name');
    if (!report) return res.status(404).json({ success: false, message: 'Report not found or expired' });
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
