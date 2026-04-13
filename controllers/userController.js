const User = require('../models/User');
const Department = require('../models/Department');
const { logActivity } = require('../utils/logActivity');
const { parsePhone } = require('../utils/phone');
const { sanitizeModulePermissions, resolveModulePermissions } = require('../utils/modulePermissions');
const { setPasswordResetToken } = require('../utils/passwordReset');
const { sendWelcomeEmail } = require('../utils/email');
const { userBelongsToAnyDepartmentClause, userBelongsToDepartmentClause } = require('../utils/departmentScope');

function parseDepartmentMemberships(body) {
  if (Array.isArray(body.departmentMemberships) && body.departmentMemberships.length) {
    return body.departmentMemberships
      .map(({ departmentId, role }) => ({
        departmentId: departmentId || null,
        role: String(role || '').trim(),
      }))
      .filter((m) => m.departmentId);
  }
  if (body.departmentId) {
    return [{ departmentId: body.departmentId, role: String(body.departmentRole || '').trim() }];
  }
  return [];
}

/** Ensure API returns memberships for legacy users (only departmentId in DB). */
function ensureMembershipsShape(user) {
  if (!user) return user;
  const u = user.toObject ? user.toObject() : { ...user };
  if (u.departmentId && (!u.departmentMemberships || !u.departmentMemberships.length)) {
    u.departmentMemberships = [{
      departmentId: u.departmentId,
      role: u.departmentRole || '',
    }];
  }
  return u;
}

async function addUserToDepartments(userId, departmentIds) {
  const ids = [...new Set((departmentIds || []).map(String).filter(Boolean))];
  await Promise.all(ids.map((id) => Department.findByIdAndUpdate(id, { $addToSet: { members: userId } })));
}

async function removeUserFromDepartments(userId, departmentIds) {
  const ids = [...new Set((departmentIds || []).map(String).filter(Boolean))];
  await Promise.all(ids.map((id) => Department.findByIdAndUpdate(id, { $pull: { members: userId } })));
}

function membershipDeptIds(memberships) {
  return (memberships || []).map((m) => m.departmentId).filter(Boolean).map(String);
}

// @GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const filter = { deletedAt: null };
    if (req.query.role) filter.role = req.query.role;
    if (req.query.active !== undefined) filter.isActive = req.query.active === 'true';

    const andParts = [];
    if (req.query.department) {
      andParts.push(userBelongsToDepartmentClause(req.query.department));
    }
    if (!req.scopeAll && req.scopeDepartments?.length) {
      andParts.push(userBelongsToAnyDepartmentClause(req.scopeDepartments));
    }
    if (andParts.length) filter.$and = andParts;

    const users = await User.find(filter)
      .populate('departmentId', 'name slug color')
      .populate('departmentMemberships.departmentId', 'name slug color')
      .sort('name')
      .lean();
    const shaped = users.map((u) => ensureMembershipsShape(u));
    res.json({ success: true, count: shaped.length, users: shaped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/admins — Administrators module (super_admin only)
exports.listAdmins = async (req, res) => {
  try {
    const filter = { deletedAt: null, role: 'admin' };
    if (!req.scopeAll && req.scopeDepartments?.length) {
      filter.$and = [userBelongsToAnyDepartmentClause(req.scopeDepartments)];
    }
    const users = await User.find(filter)
      .populate('departmentId', 'name slug color')
      .populate('departmentMemberships.departmentId', 'name slug color')
      .sort('name')
      .lean();
    const shaped = users.map((u) => ensureMembershipsShape(u));
    res.json({ success: true, count: shaped.length, users: shaped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/admins — create user with role admin (super_admin only)
exports.createAdminUser = async (req, res) => {
  req.body = { ...req.body, role: 'admin' };
  return exports.createUser(req, res);
};

// @POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    const memberships = parseDepartmentMemberships(req.body);
    const requestedRole = role || 'employee';
    if (['admin', 'super_admin'].includes(requestedRole) && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can create users with the admin or super admin role',
      });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });

    let phoneVal = null;
    if (phone !== undefined) {
      const p = parsePhone(phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      phoneVal = p.value;
    }

    const user = await User.create({
      name,
      email,
      password,
      role: requestedRole,
      departmentMemberships: memberships,
      phone: phoneVal,
    });

    await addUserToDepartments(user._id, membershipDeptIds(user.departmentMemberships));

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

    const populatedUser = await User.findById(user._id)
      .populate('departmentId', 'name slug color')
      .populate('departmentMemberships.departmentId', 'name slug color');
    const shaped = ensureMembershipsShape(populatedUser);
    res.status(201).json({ success: true, user: shaped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/users/:id
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('departmentId')
      .populate('departmentMemberships.departmentId', 'name slug color');
    if (!user || user.deletedAt) return res.status(404).json({ success: false, message: 'User not found' });
    const u = ensureMembershipsShape(user);
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
    if (!target || target.deletedAt) return res.status(404).json({ success: false, message: 'User not found' });
    if (target.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Super admin permissions are fixed (full access) and cannot be edited',
      });
    }

    const sanitized = sanitizeModulePermissions(req.body.modulePermissions || {});
    target.modulePermissions = Object.keys(sanitized).length ? sanitized : undefined;
    await target.save();

    const populated = await User.findById(target._id)
      .populate('departmentId', 'name slug color')
      .populate('departmentMemberships.departmentId', 'name slug color');
    const u = ensureMembershipsShape(populated);
    u.effectiveModulePermissions = resolveModulePermissions(populated);
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/users/:id
exports.updateUser = async (req, res) => {
  try {
    const { name, email, role, phone, isActive, avatar } = req.body;
    const user = await User.findById(req.params.id);
    if (!user || user.deletedAt) return res.status(404).json({ success: false, message: 'User not found' });

    if (req.user.role !== 'super_admin' && role !== undefined && role !== user.role) {
      const involvesElevated =
        ['admin', 'super_admin'].includes(role) || ['admin', 'super_admin'].includes(user.role);
      if (involvesElevated) {
        return res.status(403).json({
          success: false,
          message: 'Only super admin can change admin or super admin roles',
        });
      }
    }

    const hasMembershipPayload =
      Array.isArray(req.body.departmentMemberships) ||
      req.body.departmentId !== undefined ||
      req.body.departmentRole !== undefined;

    let prevDeptIds = membershipDeptIds(user.departmentMemberships);
    if (!prevDeptIds.length && user.departmentId) prevDeptIds = [String(user.departmentId)];

    if (hasMembershipPayload) {
      const nextMemberships = parseDepartmentMemberships(req.body);
      user.departmentMemberships = nextMemberships;
      const nextDeptIds = membershipDeptIds(nextMemberships);
      const removed = prevDeptIds.filter((id) => !nextDeptIds.includes(id));
      const added = nextDeptIds.filter((id) => !prevDeptIds.includes(id));
      await removeUserFromDepartments(user._id, removed);
      await addUserToDepartments(user._id, added);
    }

    Object.assign(user, { name, email, role, isActive, avatar });
    if (phone !== undefined) {
      const p = parsePhone(phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      user.phone = p.value;
    }
    await user.save();

    const updated = await User.findById(user._id)
      .populate('departmentId', 'name slug color')
      .populate('departmentMemberships.departmentId', 'name slug color');
    res.json({ success: true, user: ensureMembershipsShape(updated) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/users/:id  (deactivate — not trash)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.deletedAt) return res.status(404).json({ success: false, message: 'User not found' });
    user.isActive = false;
    await user.save();
    res.json({ success: true, message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/users/:id/trash  (super_admin only — soft-delete user into trash)
exports.trashUser = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You cannot move yourself to trash' });
    }
    if (target.role === 'super_admin') {
      return res.status(403).json({ success: false, message: 'Cannot move a super admin to trash' });
    }
    if (target.deletedAt) {
      return res.status(400).json({ success: false, message: 'User is already in trash' });
    }
    target.deletedAt = new Date();
    target.deletedBy = req.user._id;
    target.isActive = false;
    let deptIds = membershipDeptIds(target.departmentMemberships);
    if (!deptIds.length && target.departmentId) deptIds = [String(target.departmentId)];
    await removeUserFromDepartments(target._id, deptIds);
    await target.save();
    await logActivity({
      actorId: req.user._id,
      action: 'USER_TRASHED',
      targetType: 'user',
      targetId: target._id,
      label: `${target.name} (${target.email})`,
    });
    res.json({ success: true, message: 'User moved to trash' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/users/:id/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    const user = await User.findById(req.params.id);
    if (!user || user.deletedAt) return res.status(404).json({ success: false, message: 'User not found' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
