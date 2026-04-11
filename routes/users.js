const express = require('express');
const router = express.Router();
const {
  getUsers, createUser, getUser, updateUser, deleteUser, resetPassword, updateUserPermissions,
} = require('../controllers/userController');
const { protect, departmentScope, authorize } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('team', 'view'), getUsers);
router.post('/', requireModuleAction('team', 'create'), createUser);
router.get('/:id', requireModuleAction('team', 'view'), getUser);
router.put('/:id/permissions', authorize('super_admin', 'admin'), updateUserPermissions);
router.put('/:id', requireModuleAction('team', 'edit'), updateUser);
router.delete('/:id', requireModuleAction('team', 'delete'), deleteUser);
router.put('/:id/reset-password', requireModuleAction('team', 'edit'), resetPassword);

module.exports = router;
