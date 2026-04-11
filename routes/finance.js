const express = require('express');
const router = express.Router();
const {
  getInvoices, createInvoice, getInvoice,
  updateInvoice, deleteInvoice, markPaid, getFinanceSummary, getRevenueChart
} = require('../controllers/financeController');
const { protect, departmentScope } = require('../middleware/auth');

router.use(protect, departmentScope);

router.get('/summary', getFinanceSummary);
router.get('/revenue-chart', getRevenueChart);
router.get('/invoices', getInvoices);
router.post('/invoices', createInvoice);
router.get('/invoices/:id', getInvoice);
router.put('/invoices/:id', updateInvoice);
router.delete('/invoices/:id', deleteInvoice);
router.post('/invoices/:id/payment', markPaid);

module.exports = router;
