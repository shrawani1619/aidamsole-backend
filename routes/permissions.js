const express = require('express');
const router = express.Router();
const {
  getPermissionSchema,
  getDefaultsForRole,
  getUserPermissionsDetail,
  updateUserPermissions,
} = require('../controllers/permissionController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Schema & defaults — super_admin / admin only (used by permission admin UI)
router.get('/schema', authorize('super_admin', 'admin'), getPermissionSchema);
router.get('/defaults/:role', authorize('super_admin', 'admin'), getDefaultsForRole);

// User permission detail & update — same rules as /api/users/:id/permissions
router.get('/user/:userId', authorize('super_admin', 'admin'), getUserPermissionsDetail);
router.put('/user/:userId', authorize('super_admin', 'admin'), updateUserPermissions);

module.exports = router;
