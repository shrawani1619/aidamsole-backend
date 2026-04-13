const { hasModuleAction } = require('../utils/modulePermissions');

/**
 * After protect — requires req.user and req.effectiveModulePermissions (set in auth protect).
 * Only super_admin bypasses; all other roles (including admin) use the resolved matrix.
 */
function requireModuleAction(moduleId, action) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (moduleId === 'admins' && role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can access the Administrators module',
      });
    }
    if (role === 'super_admin') return next();

    const resolved = req.effectiveModulePermissions;
    if (!resolved) {
      return res.status(500).json({ success: false, message: 'Permissions not loaded' });
    }
    if (hasModuleAction(resolved, moduleId, action)) return next();
    return res.status(403).json({ success: false, message: `No ${action} access for ${moduleId}` });
  };
}

module.exports = {
  requireModuleAction,
};
