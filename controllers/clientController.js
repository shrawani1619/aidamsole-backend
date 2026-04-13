const Client = require('../models/Client');
const { parsePhone } = require('../utils/phone');
const Project = require('../models/Project');
const Invoice = require('../models/Invoice');
const Notification = require('../models/Notification');
const { v4: uuidv4 } = require('uuid');
const { isClientAdmin, clientAssignedAmEquals } = require('../utils/clientScope');

// @GET /api/clients
exports.getClients = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.service) filter.services = req.query.service;
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { company: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    // Non-admins only see clients where they are the assigned account manager
    if (!isClientAdmin(req.user)) {
      filter.assignedAM = req.user._id;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    let listQuery = Client.find(filter)
      .populate('assignedAM', 'name email avatar')
      .populate('assignedDepartments', 'name slug color')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    if (!isClientAdmin(req.user)) {
      listQuery = listQuery.select('-contractValue');
    }

    const [clients, total] = await Promise.all([
      listQuery.lean(),
      Client.countDocuments(filter)
    ]);

    res.json({ success: true, count: clients.length, total, page, pages: Math.ceil(total / limit), clients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/clients
exports.createClient = async (req, res) => {
  try {
    const data = { ...req.body };
    if ('phone' in data) {
      const p = parsePhone(data.phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      data.phone = p.value;
    }
    data.referralCode = uuidv4().slice(0, 8).toUpperCase();

    if (!isClientAdmin(req.user)) {
      data.assignedAM = req.user._id;
      delete data.contractValue;
    }

    const client = await Client.create(data);
    const populated = await Client.findById(client._id)
      .populate('assignedAM', 'name email avatar')
      .populate('assignedDepartments', 'name slug color');

    const createdOut = populated.toObject ? populated.toObject() : populated;
    if (!isClientAdmin(req.user)) delete createdOut.contractValue;

    // Notify AM
    if (data.assignedAM) {
      await Notification.create({
        userId: data.assignedAM,
        type: 'client',
        title: 'New Client Assigned',
        message: `${client.company} has been assigned to you`,
        link: `/clients/${client._id}`,
        priority: 'high'
      });
    }

    res.status(201).json({ success: true, client: createdOut });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/clients/:id
exports.getClient = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate('assignedAM', 'name email avatar phone')
      .populate('assignedDepartments', 'name slug color icon')
      .populate('referredBy', 'name company');
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    if (!isClientAdmin(req.user) && !clientAssignedAmEquals(req.user._id, client)) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const clientOut = client.toObject ? client.toObject() : { ...client };
    if (!isClientAdmin(req.user)) {
      delete clientOut.contractValue;
    }

    // Fetch related stats
    const [projectCount, invoiceStats] = await Promise.all([
      Project.countDocuments({ clientId: client._id }),
      Invoice.aggregate([
        { $match: { clientId: client._id } },
        { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$total', 0] } } } }
      ])
    ]);

    res.json({
      success: true,
      client: clientOut,
      stats: {
        projects: projectCount,
        totalBilled: invoiceStats[0]?.total || 0,
        totalPaid: invoiceStats[0]?.paid || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/clients/:id
exports.updateClient = async (req, res) => {
  try {
    const existing = await Client.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });
    if (!isClientAdmin(req.user) && String(existing.assignedAM) !== String(req.user._id)) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const payload = { ...req.body };
    if ('phone' in payload) {
      const p = parsePhone(payload.phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      payload.phone = p.value;
    }
    if (!isClientAdmin(req.user)) {
      delete payload.assignedAM;
      delete payload.contractValue;
    }
    const client = await Client.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true })
      .populate('assignedAM', 'name email avatar')
      .populate('assignedDepartments', 'name slug color');
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    const updatedOut = client.toObject ? client.toObject() : client;
    if (!isClientAdmin(req.user)) delete updatedOut.contractValue;
    res.json({ success: true, client: updatedOut });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/clients/:id/health-score
exports.updateHealthScore = async (req, res) => {
  try {
    const { engagement, results, payment, sentiment } = req.body;
    const overall = ((engagement + results + payment + sentiment) / 4).toFixed(1);

    const existing = await Client.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });
    if (!isClientAdmin(req.user) && String(existing.assignedAM) !== String(req.user._id)) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const client = await Client.findByIdAndUpdate(
      req.params.id,
      {
        'healthScore.engagement': engagement,
        'healthScore.results': results,
        'healthScore.payment': payment,
        'healthScore.sentiment': sentiment,
        'healthScore.overall': overall,
        'healthScore.lastUpdated': new Date()
      },
      { new: true }
    );

    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    // Auto-update status based on score
    let newStatus = client.status;
    if (overall >= 8 && client.status === 'at_risk') newStatus = 'active';
    if (overall < 5 && client.status === 'active') newStatus = 'at_risk';
    if (newStatus !== client.status) {
      client.status = newStatus;
      await client.save();
    }

    // Alert if red
    if (overall < 5 && client.assignedAM) {
      await Notification.create({
        userId: client.assignedAM,
        type: 'health_alert',
        title: '🚨 Client At Risk',
        message: `${client.company} health score dropped to ${overall}. Immediate action required.`,
        link: `/clients/${client._id}`,
        priority: 'high'
      });
    }

    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/clients/:id
exports.deleteClient = async (req, res) => {
  try {
    const existing = await Client.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });
    if (!isClientAdmin(req.user) && String(existing.assignedAM) !== String(req.user._id)) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const [projectCount, invoiceCount] = await Promise.all([
      Project.countDocuments({ clientId: req.params.id }),
      Invoice.countDocuments({ clientId: req.params.id })
    ]);

    if (projectCount > 0 || invoiceCount > 0) {
      const parts = [];
      if (projectCount > 0) parts.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
      if (invoiceCount > 0) parts.push(`${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`);
      return res.status(400).json({
        success: false,
        message: `Cannot delete this client: it still has ${parts.join(' and ')}. Remove or reassign them first.`,
        projectCount,
        invoiceCount
      });
    }

    const client = await Client.findByIdAndDelete(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    res.json({ success: true, message: 'Client deleted permanently' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/clients/:id/timeline
exports.getClientTimeline = async (req, res) => {
  try {
    const clientRow = await Client.findById(req.params.id).select('assignedAM').lean();
    if (!clientRow) return res.status(404).json({ success: false, message: 'Client not found' });
    if (!isClientAdmin(req.user) && String(clientRow.assignedAM) !== String(req.user._id)) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const [projects, invoices] = await Promise.all([
      Project.find({ clientId: req.params.id }).sort({ createdAt: -1 }).limit(10).lean(),
      Invoice.find({ clientId: req.params.id }).sort({ createdAt: -1 }).limit(10).lean()
    ]);

    const timeline = [
      ...projects.map(p => ({ type: 'project', date: p.createdAt, title: p.title, status: p.status })),
      ...invoices.map(i => ({ type: 'invoice', date: i.createdAt, title: `Invoice ${i.invoiceNumber}`, status: i.status, amount: i.total }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, timeline });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
