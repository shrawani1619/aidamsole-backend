const User = require('../models/User');
const Department = require('../models/Department');
const { parsePhone } = require('../utils/phone');
const { sanitizeModulePermissions, resolveModulePermissions } = require('../utils/modulePermissions');
const { setPasswordResetToken } = require('../utils/passwordReset');
const { sendWelcomeEmail } = require('../utils/email');

// @GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const filter = {};
    if (req.query.department) filter.departmentId = req.query.department;
    if (req.query.role) filter.role = req.query.role;
    if (req.query.active !== undefined) filter.isActive = req.query.active === 'true';

    // Department scope
    if (req.scopeDepartment) filter.departmentId = req.scopeDepartment;

    const users = await User.find(filter).populate('departmentId', 'name slug color').sort('name').lean();
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, departmentId, departmentRole, phone } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });

    let phoneVal = null;
    if (phone !== undefined) {
      const p = parsePhone(phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      phoneVal = p.value;
    }

    const user = await User.create({ name, email, password, role, departmentId, departmentRole, phone: phoneVal });

    // Add user to department members
    if (departmentId) {
      await Department.findByIdAndUpdate(departmentId, { $addToSet: { members: user._id } });
    }

    // Welcome email: temporary password + optional secure link to set password (1h)
    (async () => {
      try {
        const raw = await setPasswordResetToken(user._id);
        const base = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
        const setupUrl = `${base}/reset-password?token=${encodeURIComponent(raw)}`;
        await sendWelcomeEmail(user, password, setupUrl);
      } catch (err) {
        console.error('[createUser] welcome email:', err.message || err);
      }
    })();

    const populatedUser = await User.findById(user._id).populate('departmentId', 'name slug color');
    res.status(201).json({ success: true, user: populatedUser });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/users/:id
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('departmentId');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const u = user.toObject ? user.toObject() : user;
    u.effectiveModulePermissions = resolveModulePermissions(user);
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/users/:id/permissions  (super_admin / admin only — route guard)
exports.updateUserPermissions = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (target.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Cannot change super admin permissions' });
    }

    const sanitized = sanitizeModulePermissions(req.body.modulePermissions || {});
    target.modulePermissions = Object.keys(sanitized).length ? sanitized : undefined;
    await target.save();

    const populated = await User.findById(target._id).populate('departmentId', 'name slug color');
    const u = populated.toObject ? populated.toObject() : populated;
    u.effectiveModulePermissions = resolveModulePermissions(populated);
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/users/:id
exports.updateUser = async (req, res) => {
  try {
    const { name, email, role, departmentId, departmentRole, phone, isActive, avatar } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Handle department change
    if (departmentId && departmentId !== String(user.departmentId)) {
      if (user.departmentId) {
        await Department.findByIdAndUpdate(user.departmentId, { $pull: { members: user._id } });
      }
      await Department.findByIdAndUpdate(departmentId, { $addToSet: { members: user._id } });
    }

    Object.assign(user, { name, email, role, departmentId, departmentRole, isActive, avatar });
    if (phone !== undefined) {
      const p = parsePhone(phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      user.phone = p.value;
    }
    await user.save();

    const updated = await User.findById(user._id).populate('departmentId', 'name slug color');
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isActive = false;
    await user.save();
    res.json({ success: true, message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/users/:id/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
