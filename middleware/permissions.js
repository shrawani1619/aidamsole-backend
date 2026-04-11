const { hasModuleAction } = require('../utils/modulePermissions');

/**
 * After protect — requires req.user and req.effectiveModulePermissions (set in auth protect).
 * super_admin / admin always pass.
 */
function requireModuleAction(moduleId, action) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (role === 'super_admin' || role === 'admin') return next();

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
