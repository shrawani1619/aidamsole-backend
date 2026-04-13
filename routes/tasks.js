const express = require('express');
const router = express.Router();
const {
  getTasks, createTask, getTask, updateTask, deleteTask,
  twoEyeApprove, reassignTask, addComment, logTime, updateSubtask
} = require('../controllers/taskController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('tasks', 'view'), getTasks);
router.post('/', requireModuleAction('tasks', 'create'), createTask);
router.get('/:id', requireModuleAction('tasks', 'view'), getTask);
router.put('/:id/reassign', requireModuleAction('tasks', 'view'), reassignTask);
router.put('/:id', requireModuleAction('tasks', 'edit'), updateTask);
router.delete('/:id', requireModuleAction('tasks', 'delete'), deleteTask);
router.put('/:id/two-eye-approve', requireModuleAction('tasks', 'edit'), twoEyeApprove);
router.post('/:id/comments', requireModuleAction('tasks', 'edit'), addComment);
router.post('/:id/time-log', requireModuleAction('tasks', 'edit'), logTime);
router.put('/:id/subtask/:subtaskId', requireModuleAction('tasks', 'edit'), updateSubtask);

module.exports = router;
