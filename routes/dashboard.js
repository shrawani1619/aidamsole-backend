const express = require('express');
const router = express.Router();
const { getDashboard, getHealthScores, getStandupData } = require('../controllers/dashboardController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('dashboard', 'view'), getDashboard);
router.get('/health-scores', requireModuleAction('dashboard', 'view'), getHealthScores);
router.get('/standup', requireModuleAction('dashboard', 'view'), getStandupData);

module.exports = router;
