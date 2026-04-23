const express = require('express');
const router = express.Router();
const {
  getTrash,
  restoreUser,
  restoreTask,
  permanentDeleteUser,
  permanentDeleteTask,
} = require('../controllers/trashController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('trash', 'view'), getTrash);
router.post('/restore/user/:id', requireModuleAction('trash', 'edit'), restoreUser);
router.post('/restore/task/:id', requireModuleAction('trash', 'edit'), restoreTask);
router.delete('/user/:id', requireModuleAction('trash', 'delete'), permanentDeleteUser);
router.delete('/task/:id', requireModuleAction('trash', 'delete'), permanentDeleteTask);

module.exports = router;
