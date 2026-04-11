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
const { requireModuleAction } = require('../middleware/permissions');

// Public shared report — no auth needed
router.get('/shared/:token', getSharedReport);

// All other report routes: authenticated + dept scoped
router.use(protect, departmentScope);

// Financial report exposes revenue/MRR — requires finance access in addition to reports
router.get(
  '/financial',
  requireModuleAction('reports', 'view'),
  requireModuleAction('finance', 'view'),
  getFinancialReport
);
router.get(
  '/client-performance',
  requireModuleAction('reports', 'view'),
  requireModuleAction('clients', 'view'),
  getClientPerformanceReport
);
router.get(
  '/team-performance',
  requireModuleAction('reports', 'view'),
  requireModuleAction('team', 'view'),
  getTeamPerformanceReport
);
router.get('/operational', requireModuleAction('reports', 'view'), getOperationalReport);
router.get('/super-admin-insights', requireModuleAction('dashboard', 'view'), getSuperAdminInsights);
router.post('/share', requireModuleAction('reports', 'view'), generateShareLink);

module.exports = router;
