const User = require('../models/User');
const {
  MODULE_IDS,
  ACTIONS,
  DASHBOARD_FIELD_KEYS,
  REPORTS_FIELD_KEYS,
  defaultsForRole,
  resolveModulePermissions,
  sanitizeModulePermissions,
} = require('../utils/modulePermissions');

const ROLES = ['super_admin', 'admin', 'department_manager', 'employee'];

/** Human-readable labels for API consumers (admin UI, mobile, integrations). */
const MODULE_LABELS = {
  dashboard: 'Dashboard',
  clients: 'Clients',
  projects: 'Projects',
  tasks: 'Tasks',
  departments: 'Departments',
  team: 'Team & users',
  reports: 'Reports',
  finance: 'Finance',
  chat: 'Chat',
};

const ACTION_LABELS = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
};

const DASHBOARD_FIELD_LABELS = {
  mrr: 'MRR',
  activeClients: 'Active clients KPI',
  thisMonthRevenue: 'This month revenue',
  delayedTasks: 'Delayed tasks KPI',
  clientHealth: 'Client health',
  deptPerformance: 'Department performance',
  riskClients: 'At-risk clients',
  topClients: 'Top clients',
  revenueHistory: 'Revenue history',
};

const REPORTS_FIELD_LABELS = {
  financial: 'Financial report',
  client: 'Client performance',
  team: 'Team performance',
  operational: 'Operational',
};

/**
 * GET /api/permissions/schema
 * Returns module ids, actions, and field keys so clients can build permission forms.
 */
exports.getPermissionSchema = (_req, res) => {
  try {
    res.json({
      success: true,
      data: {
        modules: MODULE_IDS.map((id) => ({ id, label: MODULE_LABELS[id] || id })),
        actions: ACTIONS.map((id) => ({ id, label: ACTION_LABELS[id] || id })),
        fields: {
          dashboard: DASHBOARD_FIELD_KEYS.map((id) => ({
            id,
            label: DASHBOARD_FIELD_LABELS[id] || id,
            moduleId: 'dashboard',
          })),
          reports: REPORTS_FIELD_KEYS.map((id) => ({
            id,
            label: REPORTS_FIELD_LABELS[id] || id,
            moduleId: 'reports',
          })),
        },
        description:
          'Each user may have modulePermissions overrides merged with role defaults. ' +
          'Super admin and admin always receive full access when resolved.',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/permissions/defaults/:role
 * Returns the effective permission matrix for a role without per-user overrides.
 */
exports.getDefaultsForRole = (req, res) => {
  try {
    const role = (req.params.role || '').trim();
    if (!ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Use one of: ${ROLES.join(', ')}`,
      });
    }
    const effectiveModulePermissions = defaultsForRole(role);
    res.json({
      success: true,
      data: {
        role,
        effectiveModulePermissions,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/permissions/user/:userId
 * Returns stored overrides, resolved effective permissions, and schema reference.
 */
exports.getUserPermissionsDetail = async (req, res) => {
  try {
    const target = await User.findById(req.params.userId).populate('departmentId', 'name slug color');
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    const userObj = target.toObject ? target.toObject() : target;
    const effectiveModulePermissions = resolveModulePermissions(target);
    res.json({
      success: true,
      data: {
        userId: target._id,
        role: target.role,
        modulePermissions: target.modulePermissions || null,
        effectiveModulePermissions,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/permissions/user/:userId
 * Same body as PUT /api/users/:id/permissions — centralized alias.
 */
exports.updateUserPermissions = async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
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
