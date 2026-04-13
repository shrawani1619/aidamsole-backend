const Task = require('../models/Task');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Department = require('../models/Department');
const Project = require('../models/Project');
const Client = require('../models/Client');
const { logActivity } = require('../utils/logActivity');
const { isClientAdmin, clientIdsForAssignedAm } = require('../utils/clientScope');
const { userBelongsToAnyDepartmentClause } = require('../utils/departmentScope');

const toOid = (v) => (v && String(v).trim() ? v : null);

/** Non-admins may only access tasks belonging to clients where they are assigned AM */
async function userOwnsClientForTask(req, clientId) {
  if (!clientId) return false;
  if (isClientAdmin(req.user)) return true;
  const c = await Client.findById(clientId).select('assignedAM').lean();
  return !!(c && String(c.assignedAM) === String(req.user._id));
}

/** Unique non-null ObjectIds from mixed inputs (string, populated doc, etc.) */
function uniqReviewerOids(values) {
  const seen = new Set();
  const out = [];
  for (const v of values || []) {
    const raw = v && typeof v === 'object' && v._id ? v._id : v;
    const id = toOid(raw);
    if (id && !seen.has(String(id))) {
      seen.add(String(id));
      out.push(id);
    }
  }
  return out;
}

/** Resolve main-task reviewers from request body + optional previous task */
function resolveMainReviewers(body, prevTask, isCreate) {
  const hasReviewerIds = Object.prototype.hasOwnProperty.call(body, 'reviewerIds');
  const hasReviewerId = Object.prototype.hasOwnProperty.call(body, 'reviewerId');
  if (hasReviewerIds) {
    const list = uniqReviewerOids(body.reviewerIds);
    return { reviewerIds: list, reviewerId: list[0] || null };
  }
  if (hasReviewerId) {
    const list = body.reviewerId ? uniqReviewerOids([body.reviewerId]) : [];
    return { reviewerIds: list, reviewerId: list[0] || null };
  }
  if (!isCreate && prevTask) {
    const list = prevTask.reviewerIds?.length
      ? uniqReviewerOids(prevTask.reviewerIds)
      : prevTask.reviewerId
        ? uniqReviewerOids([prevTask.reviewerId])
        : [];
    return { reviewerIds: list, reviewerId: list[0] || null };
  }
  return { reviewerIds: [], reviewerId: null };
}

function isUserTaskReviewer(taskDoc, userId) {
  const uid = String(userId);
  const arr = (taskDoc.reviewerIds || []).map((id) => String(id));
  if (arr.includes(uid)) return true;
  if (taskDoc.reviewerId && String(taskDoc.reviewerId) === uid) return true;
  return false;
}

/** Collect reviewer user ids from a possibly populated task for notifications */
function reviewerUserIdsFromTask(task) {
  const ids = [];
  if (task.reviewerIds?.length) {
    task.reviewerIds.forEach((r) => {
      const id = r?._id || r;
      if (id) ids.push(String(id));
    });
  } else if (task.reviewerId) {
    const id = task.reviewerId._id || task.reviewerId;
    if (id) ids.push(String(id));
  }
  return [...new Set(ids)];
}

/** Normalize subtasks: inherit parent ids when omitted; align completed with status */
function normalizeSubtasksForParent(parent, subtasks) {
  if (!Array.isArray(subtasks)) return [];
  return subtasks
    .filter((st) => st && String(st.title || '').trim())
    .map((st) => {
      const status = st.status || 'todo';
      const completed = st.completed === true || ['done', 'approved'].includes(status);
      return {
        ...(st._id && { _id: st._id }),
        title: String(st.title).trim(),
        description: st.description || '',
        projectId: toOid(st.projectId) || parent.projectId,
        clientId: toOid(st.clientId) || parent.clientId,
        departmentId: toOid(st.departmentId) || parent.departmentId,
        assigneeId: toOid(st.assigneeId),
        reviewerId: toOid(st.reviewerId),
        status,
        priority: st.priority || 'medium',
        dueDate: st.dueDate ? new Date(st.dueDate) : null,
        estimatedHours: st.estimatedHours === '' || st.estimatedHours == null ? 0 : Number(st.estimatedHours) || 0,
        completed,
        completedAt: completed ? (st.completedAt ? new Date(st.completedAt) : new Date()) : null
      };
    });
}

// @GET /api/tasks
exports.getTasks = async (req, res) => {
  try {
    const filter = { deletedAt: null };
    if (req.query.project) filter.projectId = req.query.project;
    if (req.query.client) filter.clientId = req.query.client;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.assignee) filter.assigneeId = req.query.assignee;
    if (req.query.delayed === 'true') filter.isDelayed = true;
    if (req.query.search) filter.title = { $regex: req.query.search, $options: 'i' };

    // Non-admins only see tasks for clients where they are the assigned account manager
    if (!isClientAdmin(req.user)) {
      const myClientIds = await clientIdsForAssignedAm(req.user._id);
      const allowed = new Set(myClientIds.map(String));
      if (req.query.client) {
        if (!allowed.has(String(req.query.client))) filter._id = { $in: [] };
      } else if (req.query.project) {
        const proj = await Project.findById(req.query.project).select('clientId').lean();
        if (!proj || !allowed.has(String(proj.clientId))) filter._id = { $in: [] };
      } else {
        filter.clientId = myClientIds.length ? { $in: myClientIds } : { $in: [] };
      }
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('projectId', 'title service')
        .populate('clientId', 'name company logo')
        .populate('departmentId', 'name slug color')
        .populate('assigneeId', 'name email avatar')
        .populate('reviewerId', 'name email avatar')
        .populate('reviewerIds', 'name email avatar')
        .populate('createdBy', 'name email avatar')
        .sort({ dueDate: 1, priority: -1 })
        .skip(skip).limit(limit).lean(),
      Task.countDocuments(filter)
    ]);

    res.json({ success: true, count: tasks.length, total, page, pages: Math.ceil(total / limit), tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/tasks/meta
// Task form support data without requiring Team/Departments module access.
exports.getTaskMeta = async (req, res) => {
  try {
    const usersFilter = { deletedAt: null, isActive: true };
    if (!req.scopeAll && req.scopeDepartments?.length) {
      usersFilter.$and = [userBelongsToAnyDepartmentClause(req.scopeDepartments)];
    }

    const departmentsFilter = { isActive: true };
    if (!req.scopeAll && req.scopeDepartments?.length) {
      departmentsFilter._id =
        req.scopeDepartments.length === 1
          ? req.scopeDepartments[0]
          : { $in: req.scopeDepartments };
    }

    let projectQuery = {};
    if (!isClientAdmin(req.user)) {
      const myClientIds = await clientIdsForAssignedAm(req.user._id);
      projectQuery = myClientIds.length ? { clientId: { $in: myClientIds } } : { _id: { $in: [] } };
    }

    const [users, departments, projects] = await Promise.all([
      User.find(usersFilter).select('name email avatar role departmentId departmentMemberships').sort('name').lean(),
      Department.find(departmentsFilter).select('name slug color').sort('name').lean(),
      Project.find(projectQuery)
        .select('title clientId departmentId status')
        .populate('clientId', 'company name')
        .populate('departmentId', 'name slug color')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    res.json({
      success: true,
      users,
      departments,
      projects,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/tasks
exports.createTask = async (req, res) => {
  try {
    const body = { ...req.body, createdBy: req.user._id };
    const rr = resolveMainReviewers(body, null, true);
    body.reviewerIds = rr.reviewerIds;
    body.reviewerId = rr.reviewerId;
    if (body.subtasks?.length) {
      body.subtasks = normalizeSubtasksForParent(
        { projectId: body.projectId, clientId: body.clientId, departmentId: body.departmentId },
        body.subtasks
      );
    }
    if (!(await userOwnsClientForTask(req, body.clientId))) {
      return res.status(403).json({ success: false, message: 'You can only create tasks for your own clients' });
    }
    const task = await Task.create(body);
    const populated = await Task.findById(task._id)
      .populate('projectId', 'title service')
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
      .populate('reviewerIds', 'name email avatar')
      .populate('subtasks.assigneeId', 'name email avatar')
      .populate('subtasks.reviewerId', 'name email avatar')
      .populate('subtasks.projectId', 'title service')
      .populate('subtasks.clientId', 'name company logo')
      .populate('subtasks.departmentId', 'name slug color');

    // Notify assignee
    if (req.body.assigneeId && String(req.body.assigneeId) !== String(req.user._id)) {
      await Notification.create({
        userId: req.body.assigneeId,
        type: 'task',
        title: 'New Task Assigned',
        message: `You have been assigned: ${task.title}`,
        link: `/tasks/${task._id}`,
        priority: req.body.priority === 'critical' ? 'high' : 'medium'
      });
    }
    for (const rid of rr.reviewerIds) {
      if (String(rid) === String(req.user._id)) continue;
      if (req.body.assigneeId && String(rid) === String(req.body.assigneeId)) continue;
      await Notification.create({
        userId: rid,
        type: 'task',
        title: 'Review requested',
        message: `You are a reviewer for: ${task.title}`,
        link: `/tasks/${task._id}`,
        priority: 'medium'
      });
    }

    // Emit socket event
    req.app.get('io')?.emit('task:created', { task: populated });

    res.status(201).json({ success: true, task: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/tasks/:id
exports.getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('projectId', 'title service status')
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
      .populate('reviewerIds', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('twoEyeApprovedBy', 'name email')
      .populate('subtasks.assigneeId', 'name email avatar')
      .populate('subtasks.reviewerId', 'name email avatar')
      .populate('subtasks.projectId', 'title service')
      .populate('subtasks.clientId', 'name company logo')
      .populate('subtasks.departmentId', 'name slug color')
      .populate('timeLogs.userId', 'name email avatar')
      .populate('comments.userId', 'name email avatar');
    if (!task || task.deletedAt) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, task.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id
exports.updateTask = async (req, res) => {
  try {
    const prevTask = await Task.findById(req.params.id);
    if (!prevTask || prevTask.deletedAt) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, prevTask.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const body = { ...req.body };
    if (body.clientId != null && String(body.clientId) !== String(prevTask.clientId)) {
      if (!(await userOwnsClientForTask(req, body.clientId))) {
        return res.status(403).json({ success: false, message: 'You cannot move this task to that client' });
      }
    }
    const rr = resolveMainReviewers(body, prevTask, false);
    body.reviewerIds = rr.reviewerIds;
    body.reviewerId = rr.reviewerId;
    if (body.subtasks !== undefined) {
      body.subtasks = normalizeSubtasksForParent(
        {
          projectId: body.projectId || prevTask.projectId,
          clientId: body.clientId || prevTask.clientId,
          departmentId: body.departmentId || prevTask.departmentId
        },
        body.subtasks
      );
    }

    const task = await Task.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true })
      .populate('projectId', 'title service')
      .populate('clientId', 'name company logo')
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
      .populate('reviewerIds', 'name email avatar')
      .populate('subtasks.assigneeId', 'name email avatar')
      .populate('subtasks.reviewerId', 'name email avatar')
      .populate('subtasks.projectId', 'title service')
      .populate('subtasks.clientId', 'name company logo')
      .populate('subtasks.departmentId', 'name slug color');

    // Notify on status change
    if (req.body.status && req.body.status !== prevTask.status) {
      const targets = new Set();
      if (task.assigneeId) targets.add(String(task.assigneeId._id || task.assigneeId));
      reviewerUserIdsFromTask(task).forEach((id) => targets.add(id));
      for (const uid of targets) {
        if (uid === String(req.user._id)) continue;
        await Notification.create({
          userId: uid,
          type: 'task',
          title: 'Task Status Updated',
          message: `"${task.title}" status changed to ${req.body.status.replace(/_/g, ' ')}`,
          link: `/tasks/${task._id}`,
          priority: 'medium'
        });
      }
    }

    req.app.get('io')?.emit('task:updated', { task });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id/two-eye-approve
exports.twoEyeApprove = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task || task.deletedAt) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, task.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    if (String(task.assigneeId) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Assignee cannot approve their own task' });
    }
    if (!isUserTaskReviewer(task, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only a designated reviewer can approve this task' });
    }
    task.twoEyeApproved = true;
    task.twoEyeApprovedBy = req.user._id;
    task.status = 'approved';
    await task.save();
    const populated = await Task.findById(task._id)
      .populate('projectId', 'title service')
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
      .populate('reviewerIds', 'name email avatar');
    res.json({ success: true, task: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id/reassign — assignee and/or reviewers (reviewers only)
exports.reassignTask = async (req, res) => {
  try {
    const prev = await Task.findById(req.params.id);
    if (!prev || prev.deletedAt) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, prev.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    if (!isUserTaskReviewer(prev, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only a task reviewer can reassign' });
    }
    const { assigneeId, reviewerIds } = req.body;
    if (assigneeId === undefined && reviewerIds === undefined) {
      return res.status(400).json({ success: false, message: 'Provide assigneeId and/or reviewerIds' });
    }
    const updates = {};
    let newAssigneeOid = null;
    if (assigneeId !== undefined) {
      updates.assigneeId = toOid(assigneeId);
      newAssigneeOid = updates.assigneeId;
    }
    if (reviewerIds !== undefined) {
      const merged = resolveMainReviewers({ reviewerIds }, prev, false);
      updates.reviewerIds = merged.reviewerIds;
      updates.reviewerId = merged.reviewerId;
    }
    const task = await Task.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .populate('projectId', 'title service')
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
      .populate('reviewerIds', 'name email avatar');

    const assigneeChanged =
      newAssigneeOid != null && String(prev.assigneeId || '') !== String(newAssigneeOid);
    if (assigneeChanged && newAssigneeOid && String(newAssigneeOid) !== String(req.user._id)) {
      await Notification.create({
        userId: newAssigneeOid,
        type: 'task',
        title: 'Task reassigned to you',
        message: `"${task.title}" was reassigned by a reviewer`,
        link: `/tasks/${task._id}`,
        priority: 'medium'
      });
    }

    req.app.get('io')?.emit('task:updated', { task });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/tasks/:id/comments
exports.addComment = async (req, res) => {
  try {
    const exists = await Task.findOne({ _id: req.params.id, deletedAt: null });
    if (!exists) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, exists.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { userId: req.user._id, text: req.body.text } } },
      { new: true }
    ).populate('comments.userId', 'name email avatar');
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, comments: task.comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/tasks/:id/time-log
exports.logTime = async (req, res) => {
  try {
    const pre = await Task.findOne({ _id: req.params.id, deletedAt: null });
    if (!pre) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, pre.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const { startTime, endTime, note } = req.body;
    const duration = Math.round((new Date(endTime) - new Date(startTime)) / 60000);
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      {
        $push: { timeLogs: { userId: req.user._id, startTime, endTime, duration, note } },
        $inc: { actualHours: duration / 60 }
      },
      { new: true }
    );
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id/subtask/:subtaskId
exports.updateSubtask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task || task.deletedAt) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, task.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const sub = task.subtasks.id(req.params.subtaskId);
    if (!sub) return res.status(404).json({ success: false, message: 'Subtask not found' });

    const parent = {
      projectId: task.projectId,
      clientId: task.clientId,
      departmentId: task.departmentId
    };
    const fields = [
      'title', 'description', 'projectId', 'clientId', 'departmentId',
      'assigneeId', 'reviewerId', 'status', 'priority', 'dueDate', 'estimatedHours'
    ];
    fields.forEach((key) => {
      if (req.body[key] !== undefined) {
        if (['projectId', 'clientId', 'departmentId', 'assigneeId', 'reviewerId'].includes(key)) {
          sub[key] = toOid(req.body[key]);
        } else if (key === 'dueDate') {
          sub[key] = req.body[key] ? new Date(req.body[key]) : null;
        } else if (key === 'estimatedHours') {
          sub[key] = req.body[key] === '' || req.body[key] == null ? 0 : Number(req.body[key]) || 0;
        } else {
          sub[key] = req.body[key];
        }
      }
    });
    if (req.body.completed !== undefined) sub.completed = !!req.body.completed;
    if (sub.projectId == null) sub.projectId = parent.projectId;
    if (sub.clientId == null) sub.clientId = parent.clientId;
    if (sub.departmentId == null) sub.departmentId = parent.departmentId;

    if (['done', 'approved'].includes(sub.status)) {
      sub.completed = true;
      if (!sub.completedAt) sub.completedAt = new Date();
    }
    if (req.body.completed === true) sub.completedAt = new Date();
    if (req.body.completed === false) {
      sub.completedAt = null;
      if (!['done', 'approved'].includes(sub.status)) sub.completed = false;
    }

    await task.save();
    const fresh = await Task.findById(task._id)
      .populate('subtasks.assigneeId', 'name email avatar')
      .populate('subtasks.reviewerId', 'name email avatar')
      .populate('subtasks.projectId', 'title service')
      .populate('subtasks.clientId', 'name company logo')
      .populate('subtasks.departmentId', 'name slug color');
    res.json({ success: true, subtasks: fresh.subtasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/tasks/:id  (soft-delete → trash)
exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!(await userOwnsClientForTask(req, task.clientId))) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    if (task.deletedAt) return res.status(400).json({ success: false, message: 'Task is already in trash' });
    task.deletedAt = new Date();
    task.deletedBy = req.user._id;
    await task.save();
    await logActivity({
      actorId: req.user._id,
      action: 'TASK_TRASHED',
      targetType: 'task',
      targetId: task._id,
      label: task.title,
    });
    req.app.get('io')?.emit('task:trashed', { taskId: String(task._id) });
    res.json({ success: true, message: 'Task moved to trash' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
