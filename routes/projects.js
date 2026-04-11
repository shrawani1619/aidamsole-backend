const express = require('express');
const router = express.Router();
const {
  getProjects, createProject, getProject,
  updateProject, deleteProject, getProjectTasks
} = require('../controllers/projectController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('projects', 'view'), getProjects);
router.post('/', requireModuleAction('projects', 'create'), createProject);
router.get('/:id', requireModuleAction('projects', 'view'), getProject);
router.put('/:id', requireModuleAction('projects', 'edit'), updateProject);
router.delete('/:id', requireModuleAction('projects', 'delete'), deleteProject);
router.get('/:id/tasks', requireModuleAction('projects', 'view'), getProjectTasks);

module.exports = router;
