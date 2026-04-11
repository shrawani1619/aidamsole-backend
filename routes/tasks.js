const express = require('express');
const router = express.Router();
const {
  getTasks, createTask, getTask, updateTask, deleteTask,
  twoEyeApprove, addComment, logTime, updateSubtask
} = require('../controllers/taskController');
const { protect, departmentScope } = require('../middleware/auth');

router.use(protect, departmentScope);

router.get('/', getTasks);
router.post('/', createTask);
router.get('/:id', getTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);
router.put('/:id/two-eye-approve', twoEyeApprove);
router.post('/:id/comments', addComment);
router.post('/:id/time-log', logTime);
router.put('/:id/subtask/:subtaskId', updateSubtask);

module.exports = router;
