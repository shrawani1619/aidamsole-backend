const express = require('express');
const router = express.Router();
const {
  getTrash,
  restoreUser,
  restoreTask,
  permanentDeleteUser,
  permanentDeleteTask,
} = require('../controllers/trashController');
const { protect, departmentScope, authorize } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', authorize('super_admin', 'admin'), requireModuleAction('trash', 'view'), getTrash);
router.post(
  '/restore/user/:id',
  authorize('super_admin', 'admin'),
  requireModuleAction('trash', 'edit'),
  restoreUser
);
router.post(
  '/restore/task/:id',
  authorize('super_admin', 'admin'),
  requireModuleAction('trash', 'edit'),
  restoreTask
);
router.delete(
  '/user/:id',
  authorize('super_admin'),
  requireModuleAction('trash', 'delete'),
  permanentDeleteUser
);
router.delete(
  '/task/:id',
  authorize('super_admin'),
  requireModuleAction('trash', 'delete'),
  permanentDeleteTask
);

module.exports = router;
