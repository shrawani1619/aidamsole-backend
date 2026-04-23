const User = require('../models/User');
const Task = require('../models/Task');
const Department = require('../models/Department');
const { logActivity } = require('../utils/logActivity');
const { userBelongsToAnyDepartmentClause, singleRefDepartmentFilter } = require('../utils/departmentScope');

// @GET /api/trash
exports.getTrash = async (req, res) => {
  try {
    const userFilter = { deletedAt: { $ne: null } };
    const taskFilter = { deletedAt: { $ne: null } };

    if (!req.scopeAll && req.scopeDepartments?.length) {
      Object.assign(userFilter, userBelongsToAnyDepartmentClause(req.scopeDepartments));
      Object.assign(taskFilter, singleRefDepartmentFilter(req.scopeDepartments));
    }

    const [users, tasks] = await Promise.all([
      User.find(userFilter)
        .populate('departmentId', 'name slug color')
        .populate('deletedBy', 'name email')
        .sort({ deletedAt: -1 })
        .lean(),
      Task.find(taskFilter)
        .populate('projectId', 'title service')
        .populate('clientId', 'name company logo')
        .populate('departmentId', 'name slug color')
        .populate('deletedBy', 'name email')
        .sort({ deletedAt: -1 })
        .lean(),
    ]);

    res.json({
      success: true,
      count: { users: users.length, tasks: tasks.length },
      users,
      tasks,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/trash/restore/user/:id
exports.restoreUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || !user.deletedAt) {
      return res.status(404).json({ success: false, message: 'User not in trash' });
    }
    user.deletedAt = null;
    user.deletedBy = null;
    user.isActive = true;
    await user.save();
    const memIds = (user.departmentMemberships || []).map((m) => m.departmentId).filter(Boolean).map(String);
    const deptIds = memIds.length ? memIds : (user.departmentId ? [String(user.departmentId)] : []);
    await Promise.all(deptIds.map((id) => Department.findByIdAndUpdate(id, { $addToSet: { members: user._id } })));
    const populated = await User.findById(user._id)
      .populate('departmentId', 'name slug color')
      .populate('departmentMemberships.departmentId', 'name slug color');
    await logActivity({
      actorId: req.user._id,
      action: 'USER_RESTORED',
      targetType: 'user',
      targetId: user._id,
      label: `${user.name} (${user.email})`,
    });
    res.json({ success: true, message: 'User restored', user: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/trash/restore/task/:id
exports.restoreTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task || !task.deletedAt) {
      return res.status(404).json({ success: false, message: 'Task not in trash' });
    }
    task.deletedAt = null;
    task.deletedBy = null;
    await task.save();
    const populated = await Task.findById(task._id)
      .populate('projectId', 'title service')
      .populate('clientId', 'name company logo')
      .populate('departmentId', 'name slug color')
      .populate('assigneeId', 'name email avatar');
    await logActivity({
      actorId: req.user._id,
      action: 'TASK_RESTORED',
      targetType: 'task',
      targetId: task._id,
      label: task.title,
    });
    res.json({ success: true, message: 'Task restored', task: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/trash/user/:id  (permanent — requires trash.delete in module permissions)
exports.permanentDeleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || !user.deletedAt) {
      return res.status(404).json({ success: false, message: 'User not in trash' });
    }
    const summary = `${user.name} (${user.email})`;
    const memIds = (user.departmentMemberships || []).map((m) => m.departmentId).filter(Boolean).map(String);
    const deptIds = memIds.length ? memIds : (user.departmentId ? [String(user.departmentId)] : []);
    await Promise.all(deptIds.map((id) => Department.findByIdAndUpdate(id, { $pull: { members: user._id } })));
    await User.deleteOne({ _id: user._id });
    await logActivity({
      actorId: req.user._id,
      action: 'USER_DELETED_PERMANENT',
      targetType: 'user',
      targetId: req.params.id,
      label: summary,
    });
    res.json({ success: true, message: 'User permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/trash/task/:id
exports.permanentDeleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task || !task.deletedAt) {
      return res.status(404).json({ success: false, message: 'Task not in trash' });
    }
    const title = task.title;
    await Task.deleteOne({ _id: task._id });
    await logActivity({
      actorId: req.user._id,
      action: 'TASK_DELETED_PERMANENT',
      targetType: 'task',
      targetId: req.params.id,
      label: title,
    });
    res.json({ success: true, message: 'Task permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
