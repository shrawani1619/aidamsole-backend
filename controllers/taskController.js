const Task = require('../models/Task');
const Notification = require('../models/Notification');

const toOid = (v) => (v && String(v).trim() ? v : null);

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
    const filter = {};
    if (req.query.project) filter.projectId = req.query.project;
    if (req.query.client) filter.clientId = req.query.client;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.assignee) filter.assigneeId = req.query.assignee;
    if (req.query.delayed === 'true') filter.isDelayed = true;
    if (req.query.search) filter.title = { $regex: req.query.search, $options: 'i' };

    // RBAC
    if (!req.scopeAll) {
      if (req.scopeDepartment) filter.departmentId = req.scopeDepartment;
      if (req.scopeUser) filter.$or = [{ assigneeId: req.scopeUser }, { reviewerId: req.scopeUser }, { createdBy: req.scopeUser }];
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

// @POST /api/tasks
exports.createTask = async (req, res) => {
  try {
    const body = { ...req.body, createdBy: req.user._id };
    if (body.subtasks?.length) {
      body.subtasks = normalizeSubtasksForParent(
        { projectId: body.projectId, clientId: body.clientId, departmentId: body.departmentId },
        body.subtasks
      );
    }
    const task = await Task.create(body);
    const populated = await Task.findById(task._id)
      .populate('projectId', 'title service')
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('assigneeId', 'name email avatar')
      .populate('reviewerId', 'name email avatar')
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
      .populate('createdBy', 'name email avatar')
      .populate('twoEyeApprovedBy', 'name email')
      .populate('subtasks.assigneeId', 'name email avatar')
      .populate('subtasks.reviewerId', 'name email avatar')
      .populate('subtasks.projectId', 'title service')
      .populate('subtasks.clientId', 'name company logo')
      .populate('subtasks.departmentId', 'name slug color')
      .populate('timeLogs.userId', 'name email avatar')
      .populate('comments.userId', 'name email avatar');
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id
exports.updateTask = async (req, res) => {
  try {
    const prevTask = await Task.findById(req.params.id);
    if (!prevTask) return res.status(404).json({ success: false, message: 'Task not found' });

    const body = { ...req.body };
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
      .populate('subtasks.assigneeId', 'name email avatar')
      .populate('subtasks.reviewerId', 'name email avatar')
      .populate('subtasks.projectId', 'title service')
      .populate('subtasks.clientId', 'name company logo')
      .populate('subtasks.departmentId', 'name slug color');

    // Notify on status change
    if (req.body.status && req.body.status !== prevTask.status) {
      const notifyUser = task.reviewerId || task.assigneeId;
      if (notifyUser && String(notifyUser._id) !== String(req.user._id)) {
        await Notification.create({
          userId: notifyUser._id,
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
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    if (String(task.assigneeId) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Assignee cannot approve their own task' });
    }
    task.twoEyeApproved = true;
    task.twoEyeApprovedBy = req.user._id;
    task.status = 'approved';
    await task.save();
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/tasks/:id/comments
exports.addComment = async (req, res) => {
  try {
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
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
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

// @DELETE /api/tasks/:id
exports.deleteTask = async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
