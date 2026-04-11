const express = require('express');
const router = express.Router();
const {
  getDepartments, createDepartment, getDepartment,
  updateDepartment, addMember, removeMember, getDepartmentStats
} = require('../controllers/departmentController');
const { protect, departmentScope } = require('../middleware/auth');

router.use(protect, departmentScope);

router.get('/', getDepartments);
router.post('/', createDepartment);
router.get('/:id', getDepartment);
router.put('/:id', updateDepartment);
router.post('/:id/members', addMember);
router.delete('/:id/members/:userId', removeMember);
router.get('/:id/stats', getDepartmentStats);

module.exports = router;
