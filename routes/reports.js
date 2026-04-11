const express = require('express');
const router = express.Router();
const {
  getFinancialReport,
  getClientPerformanceReport,
  getTeamPerformanceReport,
  getOperationalReport,
  getSuperAdminInsights,
  generateShareLink,
  getSharedReport
} = require('../controllers/reportController');
const { protect, departmentScope } = require('../middleware/auth');

// Public shared report — no auth needed
router.get('/shared/:token', getSharedReport);

// All other report routes: authenticated + dept scoped
router.use(protect, departmentScope);

router.get('/financial', getFinancialReport);
router.get('/client-performance', getClientPerformanceReport);
router.get('/team-performance', getTeamPerformanceReport);
router.get('/operational', getOperationalReport);
router.get('/super-admin-insights', getSuperAdminInsights);
router.post('/share', generateShareLink);

module.exports = router;
