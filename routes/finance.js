const express = require('express');
const router = express.Router();
const {
  getInvoices, createInvoice, getInvoice,
  updateInvoice, deleteInvoice, markPaid, getFinanceSummary, getRevenueChart
} = require('../controllers/financeController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/summary', requireModuleAction('finance', 'view'), getFinanceSummary);
router.get('/revenue-chart', requireModuleAction('finance', 'view'), getRevenueChart);
router.get('/invoices', requireModuleAction('finance', 'view'), getInvoices);
router.post('/invoices', requireModuleAction('finance', 'create'), createInvoice);
router.get('/invoices/:id', requireModuleAction('finance', 'view'), getInvoice);
router.put('/invoices/:id', requireModuleAction('finance', 'edit'), updateInvoice);
router.delete('/invoices/:id', requireModuleAction('finance', 'delete'), deleteInvoice);
router.post('/invoices/:id/payment', requireModuleAction('finance', 'edit'), markPaid);

module.exports = router;
