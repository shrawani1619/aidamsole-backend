const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Notification = require('../models/Notification');

// @GET /api/finance/invoices
exports.getInvoices = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.client) filter.clientId = req.query.client;
    if (req.query.type) filter.type = req.query.type;

    const now = new Date();
    if (req.query.range) {
      const ranges = {
        daily: new Date(now.setHours(0, 0, 0, 0)),
        weekly: new Date(now - 7 * 24 * 60 * 60 * 1000),
        monthly: new Date(now.getFullYear(), now.getMonth(), 1),
        yearly: new Date(now.getFullYear(), 0, 1)
      };
      if (ranges[req.query.range]) filter.issueDate = { $gte: ranges[req.query.range] };
    }

    if (!req.scopeAll && req.scopeUser) filter['$or'] = [{ createdBy: req.scopeUser }];

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('clientId', 'name company logo')
        .populate('projectId', 'title service')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      Invoice.countDocuments(filter)
    ]);

    res.json({ success: true, count: invoices.length, total, invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/finance/invoices
exports.createInvoice = async (req, res) => {
  try {
    const { lineItems, taxRate = 18, discount = 0, ...rest } = req.body;
    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    const taxAmount = (subtotal * taxRate) / 100;
    const total = subtotal + taxAmount - discount;

    const invoice = await Invoice.create({
      ...rest,
      lineItems,
      subtotal,
      taxRate,
      taxAmount,
      discount,
      total,
      createdBy: req.user._id
    });

    const populated = await Invoice.findById(invoice._id)
      .populate('clientId', 'name company logo email')
      .populate('createdBy', 'name email');

    res.status(201).json({ success: true, invoice: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/finance/invoices/:id
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('clientId', 'name company logo email phone address')
      .populate('projectId', 'title service')
      .populate('createdBy', 'name email');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/finance/invoices/:id
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('clientId', 'name company logo')
      .populate('createdBy', 'name email');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/finance/invoices/:id/mark-paid
exports.markPaid = async (req, res) => {
  try {
    const { paidAmount, paymentMethod, paymentReference } = req.body;
    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      { status: 'paid', paidDate: new Date(), paidAmount, paymentMethod, paymentReference },
      { new: true }
    ).populate('clientId', 'name company assignedAM');

    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Notify AM
    if (invoice.clientId?.assignedAM) {
      await Notification.create({
        userId: invoice.clientId.assignedAM,
        type: 'invoice',
        title: '💰 Payment Received',
        message: `${invoice.clientId.company} paid invoice ${invoice.invoiceNumber} — ₹${paidAmount.toLocaleString('en-IN')}`,
        link: `/finance/invoices/${invoice._id}`,
        priority: 'high'
      });
    }

    res.json({ success: true, invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/finance/summary
exports.getFinanceSummary = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [mrr, yearlyRevenue, outstanding, lastMonthRevenue, clientCount, byService] = await Promise.all([
      Invoice.aggregate([
        { $match: { status: 'paid', issueDate: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Invoice.aggregate([
        { $match: { status: 'paid', issueDate: { $gte: startOfYear } } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Invoice.aggregate([
        { $match: { status: { $in: ['sent', 'overdue'] } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
      ]),
      Invoice.aggregate([
        { $match: { status: 'paid', issueDate: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Client.countDocuments({ status: 'active' }),
      Invoice.aggregate([
        { $match: { status: 'paid', issueDate: { $gte: startOfYear } } },
        { $unwind: '$lineItems' },
        { $group: { _id: '$lineItems.service', revenue: { $sum: '$lineItems.total' } } },
        { $sort: { revenue: -1 } }
      ])
    ]);

    const mrrVal = mrr[0]?.total || 0;
    const lastMrrVal = lastMonthRevenue[0]?.total || 0;
    const mrrGrowth = lastMrrVal > 0 ? (((mrrVal - lastMrrVal) / lastMrrVal) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      summary: {
        mrr: mrrVal,
        mrrGrowth: parseFloat(mrrGrowth),
        yearlyRevenue: yearlyRevenue[0]?.total || 0,
        outstanding: outstanding[0]?.total || 0,
        outstandingCount: outstanding[0]?.count || 0,
        activeClients: clientCount,
        revenuePerClient: clientCount > 0 ? Math.round(mrrVal / clientCount) : 0,
        byService
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/finance/revenue-chart
exports.getRevenueChart = async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const data = await Invoice.aggregate([
      { $match: { status: 'paid', issueDate: { $gte: startDate } } },
      {
        $group: {
          _id: { year: { $year: '$issueDate' }, month: { $month: '$issueDate' } },
          revenue: { $sum: '$total' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/finance/invoices/:id
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status === 'paid') return res.status(400).json({ success: false, message: 'Cannot delete a paid invoice' });
    await invoice.deleteOne();
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
