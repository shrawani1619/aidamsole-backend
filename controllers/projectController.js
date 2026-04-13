const Project = require('../models/Project');
const Task = require('../models/Task');
const Notification = require('../models/Notification');

const SERVICE_ENUM = Project.SERVICE_ENUM || [
  'SEO', 'Paid Ads', 'Social Media', 'Web Dev', 'Email Marketing', 'Content', 'Other',
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
      if (req.scopeDepartments?.length) {
        filter.departmentId =
          req.scopeDepartments.length === 1
            ? req.scopeDepartments[0]
            : { $in: req.scopeDepartments };
      } else if (req.scopeUser) {
        // Fallback for legacy users without department scope.
        filter.$or = [{ managerId: req.scopeUser }, { team: req.scopeUser }];
      }
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

    projects.forEach((p) => {
      normalizeServiceOut(p);
      redactProjectFinancialsInPlace(p, req.user);
    });

    res.json({ success: true, count: projects.length, total, page, pages: Math.ceil(total / limit), projects });
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
      .populate('clientId', 'name company logo status healthScore assignedAM')
      .populate('departmentId', 'name slug color icon')
      .populate('managerId', 'name email avatar phone')
      .populate('team', 'name email avatar role departmentRole')
      .lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
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
    const body = { ...req.body };
    stripBudgetFieldsFromBody(body, req.user);
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
    const project = await Project.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true }).lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    redactProjectFinancialsInPlace(project, req.user);
    res.json({ success: true, message: 'Project cancelled', project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/projects/:id/tasks
exports.getProjectTasks = async (req, res) => {
  try {
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
