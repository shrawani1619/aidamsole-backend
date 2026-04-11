const express = require('express');
const router = express.Router();
const {
  getProjects, createProject, getProject,
  updateProject, deleteProject, getProjectTasks
} = require('../controllers/projectController');
const { protect, departmentScope } = require('../middleware/auth');

router.use(protect, departmentScope);

router.get('/', getProjects);
router.post('/', createProject);
router.get('/:id', getProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);
router.get('/:id/tasks', getProjectTasks);

module.exports = router;
