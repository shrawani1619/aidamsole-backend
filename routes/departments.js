const express = require('express');
const router = express.Router();
const {
  getDepartments, createDepartment, getDepartment,
  updateDepartment, addMember, removeMember, getDepartmentStats
} = require('../controllers/departmentController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('departments', 'view'), getDepartments);
router.post('/', requireModuleAction('departments', 'create'), createDepartment);
router.get('/:id', requireModuleAction('departments', 'view'), getDepartment);
router.put('/:id', requireModuleAction('departments', 'edit'), updateDepartment);
router.post('/:id/members', requireModuleAction('departments', 'edit'), addMember);
router.delete('/:id/members/:userId', requireModuleAction('departments', 'edit'), removeMember);
router.get('/:id/stats', requireModuleAction('departments', 'view'), getDepartmentStats);

module.exports = router;
