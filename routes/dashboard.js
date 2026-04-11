const express = require('express');
const router = express.Router();
const { getDashboard, getHealthScores, getStandupData } = require('../controllers/dashboardController');
const { protect, departmentScope } = require('../middleware/auth');

router.use(protect, departmentScope);

router.get('/', getDashboard);
router.get('/health-scores', getHealthScores);
router.get('/standup', getStandupData);

module.exports = router;
