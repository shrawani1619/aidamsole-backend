const Department = require('../models/Department');
const User = require('../models/User');

const normalizeDeptRoles = (arr) => {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((r) => String(r || '').trim()).filter(Boolean))];
};

/** super_admin / admin must stay global admins — never demote when they are set as dept head */
const GLOBAL_ADMIN_ROLES = ['super_admin', 'admin'];

async function assignUserAsDepartmentHead(userId, departmentId) {
  const u = await User.findById(userId);
  if (!u) return;
  const update = { departmentId };
  if (!GLOBAL_ADMIN_ROLES.includes(u.role)) update.role = 'department_manager';
  await User.findByIdAndUpdate(userId, update);
}

// @GET /api/departments
exports.getDepartments = async (req, res) => {
  try {
    // All authenticated users can see departments list
    const departments = await Department.find({ isActive: true })
      .populate('headId', 'name email avatar')
      .populate('members', 'name email avatar role departmentRole')
      .sort('name')
      .lean();
    res.json({ success: true, count: departments.length, departments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/departments
exports.createDepartment = async (req, res) => {
  try {
    const { name, description, headId, color, icon, kpis, roles } = req.body;
    const slug = name.toLowerCase().replace(/\s+/g, '_');

    const existing = await Department.findOne({ name });
    if (existing) return res.status(400).json({ success: false, message: 'Department already exists' });

    const dept = await Department.create({
      name, slug, description, headId, color, icon, kpis,
      roles: normalizeDeptRoles(roles)
    });

    if (headId) {
      await assignUserAsDepartmentHead(headId, dept._id);
      dept.members.push(headId);
      await dept.save();
    }

    const populated = await Department.findById(dept._id)
      .populate('headId', 'name email avatar')
      .populate('members', 'name email avatar');
    res.status(201).json({ success: true, department: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/departments/:id
exports.getDepartment = async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id)
      .populate('headId', 'name email avatar phone')
      .populate('members', 'name email avatar role departmentRole isActive');
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });
    res.json({ success: true, department: dept });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/departments/:id
exports.updateDepartment = async (req, res) => {
  try {
    const { name, description, headId, color, icon, kpis, isActive, roles } = req.body;
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

    // Update head if changed
    if (headId && String(headId) !== String(dept.headId)) {
      if (dept.headId) {
        const oldHead = await User.findById(dept.headId);
        if (oldHead && oldHead.role === 'department_manager') {
          oldHead.role = 'employee';
          await oldHead.save();
        }
      }
      await assignUserAsDepartmentHead(headId, dept._id);
      const memberIds = dept.members.map(String);
      if (!memberIds.includes(String(headId))) dept.members.push(headId);
    }

    if (name) dept.slug = name.toLowerCase().replace(/\s+/g, '_');
    Object.assign(dept, {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(headId && { headId }),
      ...(color && { color }),
      ...(icon !== undefined && { icon }),
      ...(kpis && { kpis }),
      ...(isActive !== undefined && { isActive }),
      ...(roles !== undefined && { roles: normalizeDeptRoles(roles) })
    });
    await dept.save();

    const updated = await Department.findById(dept._id)
      .populate('headId', 'name email avatar')
      .populate('members', 'name email avatar role departmentRole');
    res.json({ success: true, department: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/departments/:id/members
exports.addMember = async (req, res) => {
  try {
    const { userId, departmentRole } = req.body;
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

    const memberIds = dept.members.map(String);
    if (!memberIds.includes(String(userId))) dept.members.push(userId);
    await dept.save();

    await User.findByIdAndUpdate(userId, {
      departmentId: dept._id,
      ...(departmentRole && { departmentRole })
    });

    const updated = await Department.findById(dept._id)
      .populate('members', 'name email avatar role departmentRole');
    res.json({ success: true, department: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/departments/:id/members/:userId
exports.removeMember = async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

    dept.members = dept.members.filter(m => String(m) !== req.params.userId);
    await dept.save();

    await User.findByIdAndUpdate(req.params.userId, { departmentId: null, departmentRole: '' });
    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/departments/:id/stats
exports.getDepartmentStats = async (req, res) => {
  try {
    const Project = require('../models/Project');
    const Task = require('../models/Task');

    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

    const [projects, tasks] = await Promise.all([
      Project.find({ departmentId: req.params.id }),
      Task.find({ departmentId: req.params.id })
    ]);

    const stats = {
      totalMembers: dept.members.length,
      totalProjects: projects.length,
      activeProjects: projects.filter(p => p.status === 'active').length,
      completedProjects: projects.filter(p => p.status === 'completed').length,
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'done').length,
      delayedTasks: tasks.filter(t => t.isDelayed).length,
      onTimeRate: tasks.length ? Math.round((tasks.filter(t => !t.isDelayed && t.status === 'done').length / tasks.length) * 100) : 0
    };
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
