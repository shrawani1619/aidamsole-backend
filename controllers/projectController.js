const Project = require('../models/Project');
const Client = require('../models/Client');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const {
  isClientAdmin,
  clientIdsForAssignedAm,
  userHasClientAccess,
  userHasProjectViewAccess,
} = require('../utils/clientScope');

const SERVICE_ENUM = Project.SERVICE_ENUM || [
  'SEO', 'Organic Marketing', 'Meta Ads', 'Google Ads', 'Social Media', 'Web Dev', 'Email Marketing', 'Content', 'Other',
];

/** Accept legacy string or array; return deduped valid enum values (min length 0). */
function normalizeServiceInput(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const s = typeof x === 'string' ? x.trim() : '';
    if (s && SERVICE_ENUM.includes(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** API responses: legacy DB may still have a string until migration runs. */
function normalizeServiceOut(doc) {
  if (!doc || doc.service == null) return doc;
  doc.service = normalizeServiceInput(doc.service);
  return doc;
}

/** Budget / spend visible only to leadership — not regular employees. */
function canViewProjectBudget(user) {
  return user && ['super_admin', 'admin', 'department_manager'].includes(user.role);
}

function stripBudgetFieldsFromBody(body, user) {
  if (!body || canViewProjectBudget(user)) return;
  delete body.budget;
  delete body.spent;
}

/** Mutates plain project objects (lean / toObject). */
function redactProjectFinancialsInPlace(project, user) {
  if (!project || canViewProjectBudget(user)) return;
  delete project.budget;
  delete project.spent;
}

function normalizeProgressField(body) {
  if (!body || body.progress === undefined || body.progress === null || body.progress === '') return null;
  const value = Number(body.progress);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { error: 'Project progress must be between 0 and 100' };
  }
  body.progress = Math.round(value);
  return { value: body.progress };
}

// @GET /api/projects
exports.getProjects = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.client) filter.clientId = req.query.client;
    if (req.query.department) filter.departmentId = req.query.department;
    if (req.query.service) filter.service = req.query.service;
    if (req.query.search) filter.title = { $regex: req.query.search, $options: 'i' };

    // Non-admins: clients where they are AM/PM, or projects where they are on team
    if (!isClientAdmin(req.user)) {
      const myClientIds = await clientIdsForAssignedAm(req.user._id);
      const teamClause = { team: req.user._id };
      const clientClause = myClientIds.length
        ? { clientId: { $in: myClientIds } }
        : { clientId: { $in: [] } };

      if (req.query.client) {
        delete filter.clientId;
        filter.$and = [
          ...(filter.$and || []),
          { clientId: req.query.client },
          {
            $or: [
              ...(myClientIds.length ? [clientClause] : []),
              teamClause,
            ],
          },
        ];
      } else {
        filter.$or = [clientClause, teamClause];
      }
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(500, Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100));
    const skip = (page - 1) * limit;

    const filterForStatusBreakdown = { ...filter };
    delete filterForStatusBreakdown.status;

    const [projects, total, breakdownRows] = await Promise.all([
      Project.find(filter)
        .populate('clientId', 'name company logo status')
        .populate('departmentId', 'name slug color')
        .populate('managerId', 'name email avatar')
        .populate('team', 'name email avatar')
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      Project.countDocuments(filter),
      Project.aggregate([
        { $match: filterForStatusBreakdown },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    projects.forEach((p) => {
      normalizeServiceOut(p);
      redactProjectFinancialsInPlace(p, req.user);
    });

    const statusCounts = {};
    breakdownRows.forEach((row) => {
      if (row._id != null) statusCounts[row._id] = row.count;
    });

    res.json({
      success: true,
      count: projects.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      projects,
      statusCounts
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/projects
exports.createProject = async (req, res) => {
  try {
    const body = { ...req.body };
    body.service = normalizeServiceInput(body.service);
    if (!body.service.length) {
      return res.status(400).json({ success: false, message: 'Select at least one service' });
    }
    if (!body.service.includes('Other')) {
      body.serviceOtherDetail = '';
    } else {
      const d = (body.serviceOtherDetail || '').toString().trim();
      if (!d) {
        return res.status(400).json({ success: false, message: 'Please describe the other service' });
      }
      body.serviceOtherDetail = d.slice(0, 200);
    }
    stripBudgetFieldsFromBody(body, req.user);
    const progressParsed = normalizeProgressField(body);
    if (progressParsed?.error) {
      return res.status(400).json({ success: false, message: progressParsed.error });
    }

    if (!isClientAdmin(req.user)) {
      const c = await Client.findById(body.clientId).select('assignedAM projectManager').lean();
      if (!c || !userHasClientAccess(req.user._id, c)) {
        return res.status(403).json({
          success: false,
          message: 'You can only create projects for clients assigned to you',
        });
      }
    }

    const project = await Project.create(body);
    const populated = await Project.findById(project._id)
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('managerId', 'name email avatar')
      .populate('team', 'name email avatar')
      .lean();
    redactProjectFinancialsInPlace(populated, req.user);

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
      .populate('clientId', 'name company logo status healthScore assignedAM projectManager')
      .populate('departmentId', 'name slug color icon')
      .populate('managerId', 'name email avatar phone')
      .populate('team', 'name email avatar role departmentRole')
      .lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isClientAdmin(req.user) && !userHasProjectViewAccess(req.user._id, project)) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    normalizeServiceOut(project);
    redactProjectFinancialsInPlace(project, req.user);

    // Task summary
    const taskStats = await Task.aggregate([
      { $match: { projectId: project._id, deletedAt: null } },
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
    const existingProj = await Project.findById(req.params.id).populate('clientId', 'assignedAM projectManager').lean();
    if (!existingProj) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isClientAdmin(req.user)) {
      if (!existingProj.clientId || !userHasClientAccess(req.user._id, existingProj.clientId)) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
    }

    const body = { ...req.body };
    stripBudgetFieldsFromBody(body, req.user);
    const progressParsed = normalizeProgressField(body);
    if (progressParsed?.error) {
      return res.status(400).json({ success: false, message: progressParsed.error });
    }
    if (!isClientAdmin(req.user) && body.clientId != null) {
      const curCid = existingProj.clientId?._id || existingProj.clientId;
      if (String(body.clientId) !== String(curCid)) {
        return res.status(403).json({ success: false, message: 'Cannot move project to another client' });
      }
    }
    if (body.service !== undefined) {
      body.service = normalizeServiceInput(body.service);
      if (!body.service.length) {
        return res.status(400).json({ success: false, message: 'Select at least one service' });
      }
    }
    if (body.service !== undefined && !body.service.includes('Other')) {
      body.serviceOtherDetail = '';
    } else if (body.service !== undefined && body.service.includes('Other')) {
      const existing = await Project.findById(req.params.id).select('serviceOtherDetail').lean();
      if (!existing) return res.status(404).json({ success: false, message: 'Project not found' });
      const merged = body.serviceOtherDetail !== undefined
        ? String(body.serviceOtherDetail).trim()
        : (existing.serviceOtherDetail || '').toString().trim();
      if (!merged) {
        return res.status(400).json({ success: false, message: 'Please describe the other service' });
      }
      body.serviceOtherDetail = merged.slice(0, 200);
    } else if (body.serviceOtherDetail !== undefined && typeof body.serviceOtherDetail === 'string') {
      body.serviceOtherDetail = body.serviceOtherDetail.trim().slice(0, 200);
    }
    const project = await Project.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true })
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('managerId', 'name email avatar')
      .populate('team', 'name email avatar')
      .lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    normalizeServiceOut(project);
    redactProjectFinancialsInPlace(project, req.user);
    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/projects/:id/milestone
exports.updateMilestone = async (req, res) => {
  try {
    const pre = await Project.findById(req.params.id).populate('clientId', 'assignedAM projectManager').lean();
    if (!pre) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isClientAdmin(req.user)) {
      if (!pre.clientId || !userHasClientAccess(req.user._id, pre.clientId)) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
    }

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

    const out = project.toObject ? project.toObject() : { ...project };
    normalizeServiceOut(out);
    redactProjectFinancialsInPlace(out, req.user);
    res.json({ success: true, project: out });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/projects/:id
exports.deleteProject = async (req, res) => {
  try {
    const pre = await Project.findById(req.params.id).populate('clientId', 'assignedAM projectManager').lean();
    if (!pre) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isClientAdmin(req.user)) {
      if (!pre.clientId || !userHasClientAccess(req.user._id, pre.clientId)) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
    }

    const activeTaskCount = await Task.countDocuments({ projectId: req.params.id, deletedAt: null });
    if (activeTaskCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete this project: it still has ${activeTaskCount} active task${activeTaskCount === 1 ? '' : 's'}. Delete or move tasks first.`,
        activeTaskCount
      });
    }

    const project = await Project.findByIdAndDelete(req.params.id).lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    res.json({ success: true, message: 'Project deleted permanently' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/projects/:id/tasks
exports.getProjectTasks = async (req, res) => {
  try {
    const pre = await Project.findById(req.params.id).populate('clientId', 'assignedAM projectManager').lean();
    if (!pre) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isClientAdmin(req.user) && !userHasProjectViewAccess(req.user._id, pre)) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const tasks = await Task.find({ projectId: req.params.id, deletedAt: null })
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
      .populate('reviewerIds', 'name email avatar')
      .sort({ dueDate: 1, priority: -1 })
      .lean();
    res.json({ success: true, count: tasks.length, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
