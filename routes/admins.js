const express = require('express');
const router = express.Router();
const { listAdmins, createAdminUser } = require('../controllers/userController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('admins', 'view'), listAdmins);
router.post('/', requireModuleAction('admins', 'create'), createAdminUser);

module.exports = router;
