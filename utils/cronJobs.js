const cron = require('node-cron');
const Client = require('../models/Client');
const Task = require('../models/Task');
const Invoice = require('../models/Invoice');
const Notification = require('../models/Notification');
const User = require('../models/User');

module.exports = (io) => {
  const runAutoRenewalInvoices = async () => {
    try {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const plus8End = new Date(now);
      plus8End.setDate(plus8End.getDate() + 8);
      plus8End.setHours(23, 59, 59, 999);

      const fallbackUser = await User.findOne({
        role: { $in: ['super_admin', 'admin'] },
        isActive: true,
        deletedAt: null,
      }).select('_id').lean();

      const renewingClients = await Client.find({
        renewalDate: { $gte: todayStart, $lte: plus8End },
        contractValue: { $gt: 0 },
      })
        .select('company renewalDate contractValue services assignedAM projectManager')
        .lean();

      let createdCount = 0;
      for (const client of renewingClients) {
        const due = new Date(client.renewalDate);
        const dueStart = new Date(due); dueStart.setHours(0, 0, 0, 0);
        const dueEnd = new Date(due); dueEnd.setHours(23, 59, 59, 999);

        // Duplicate guard: if any non-cancelled invoice already exists for this client+renewal day, skip.
        const existing = await Invoice.findOne({
          clientId: client._id,
          dueDate: { $gte: dueStart, $lte: dueEnd },
          status: { $ne: 'cancelled' },
        }).select('_id').lean();
        if (existing) continue;

        const createdBy = client.assignedAM || client.projectManager || fallbackUser?._id;
        if (!createdBy) continue;

        const service = Array.isArray(client.services) && client.services.length ? client.services[0] : 'Other';
        const amount = Number(client.contractValue) || 0;
        if (amount <= 0) continue;

        await Invoice.create({
          clientId: client._id,
          createdBy,
          status: 'draft',
          source: 'renewal_t_minus_8',
          issueDate: now,
          dueDate: due,
          lineItems: [{
            description: `Renewal invoice for ${client.company}`,
            service,
            quantity: 1,
            unitPrice: amount,
            total: amount,
          }],
          subtotal: amount,
          taxRate: 18,
          taxAmount: (amount * 18) / 100,
          discount: 0,
          total: amount + (amount * 18) / 100,
          notes: `Auto-generated 8 days before renewal (${due.toLocaleDateString('en-IN')})`,
        });
        createdCount++;
      }

      console.log(`🧾 Auto-renewal scan complete: ${renewingClients.length} candidate client(s), ${createdCount} invoice(s) created`);
    } catch (err) {
      console.error('Cron auto renewal invoice error:', err.message);
    }
  };

  // ── Every hour: flag overdue tasks ──────────────────────────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const result = await Task.updateMany(
        {
          dueDate: { $lt: now },
          status: { $nin: ['done', 'approved'] },
          isDelayed: false,
          deletedAt: null,
        },
        { $set: { isDelayed: true } }
      );
      if (result.modifiedCount > 0) {
        console.log(`⏰ Flagged ${result.modifiedCount} overdue tasks`);
      }
    } catch (err) {
      console.error('Cron overdue tasks error:', err.message);
    }
  });

  // ── Every hour: flag overdue invoices ───────────────────────────────────────
  cron.schedule('30 * * * *', async () => {
    try {
      const now = new Date();
      const result = await Invoice.updateMany(
        { dueDate: { $lt: now }, status: { $in: ['sent', 'viewed'] } },
        { $set: { status: 'overdue' } }
      );
      if (result.modifiedCount > 0) {
        console.log(`💳 Flagged ${result.modifiedCount} invoices as overdue`);
      }
    } catch (err) {
      console.error('Cron overdue invoices error:', err.message);
    }
  });

  // ── Every Friday 4:30 PM: health score review alert ─────────────────────────
  cron.schedule('30 16 * * 5', async () => {
    try {
      const atRiskClients = await Client.find({
        status: 'active',
        'healthScore.overall': { $lt: 5 }
      }).populate('assignedAM', '_id name');

      for (const client of atRiskClients) {
        if (!client.assignedAM) continue;
        await Notification.create({
          userId: client.assignedAM._id,
          type: 'health_alert',
          title: '🚨 Weekly Health Review — Client At Risk',
          message: `${client.company} has a health score of ${client.healthScore.overall}/10. Call them today.`,
          link: `/clients/${client._id}`,
          priority: 'high'
        });
        // Push real-time notification
        io.emit('notification:new', {
          userId: client.assignedAM._id,
          message: `${client.company} health score alert`
        });
      }
      console.log(`📊 Weekly health alerts sent for ${atRiskClients.length} at-risk clients`);
    } catch (err) {
      console.error('Cron health alert error:', err.message);
    }
  });

  // ── Every day 9 AM: renewal reminders (30 days ahead) ───────────────────────
  cron.schedule('0 9 * * *', async () => {
    try {
      const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

      const renewingClients = await Client.find({
        renewalDate: { $gte: todayStart, $lte: new Date(todayStart.getTime() + 30 * 24 * 60 * 60 * 1000) },
        status: 'active'
      }).populate('assignedAM', '_id');

      for (const client of renewingClients) {
        if (!client.assignedAM) continue;
        const daysLeft = Math.ceil((new Date(client.renewalDate) - new Date()) / (1000 * 60 * 60 * 24));
        if ([30, 14, 7, 3, 1].includes(daysLeft)) {
          await Notification.create({
            userId: client.assignedAM._id,
            type: 'client',
            title: `🔄 Renewal in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
            message: `${client.company} contract renews on ${new Date(client.renewalDate).toLocaleDateString('en-IN')}. Schedule QBR now.`,
            link: `/clients/${client._id}`,
            priority: daysLeft <= 7 ? 'high' : 'medium'
          });
        }
      }
      console.log(`🔄 Renewal reminders sent`);
    } catch (err) {
      console.error('Cron renewal reminder error:', err.message);
    }
  });

  // ── Every Monday 8:30 AM: weekly standup prep notification ──────────────────
  cron.schedule('30 8 * * 1', async () => {
    try {
      const delayedCount = await Task.countDocuments({
        isDelayed: true,
        status: { $nin: ['done', 'approved'] },
        deletedAt: null,
      });
      const atRiskCount = await Client.countDocuments({ status: 'at_risk' });

      // Notify all admins/managers
      const managers = await require('../models/User').find({
        role: { $in: ['super_admin', 'admin', 'department_manager'] },
        isActive: true,
        deletedAt: null,
      }).select('_id');

      const notifications = managers.map(m => ({
        userId: m._id,
        type: 'system',
        title: '📋 Weekly Standup Briefing',
        message: `This week: ${delayedCount} delayed tasks, ${atRiskCount} at-risk clients. Review dashboard.`,
        link: '/dashboard/standup',
        priority: 'medium'
      }));

      if (notifications.length) await Notification.insertMany(notifications);
      console.log(`📋 Weekly standup notifications sent to ${managers.length} managers`);
    } catch (err) {
      console.error('Cron standup error:', err.message);
    }
  });

  // ── Every day 8:45 AM: auto-generate renewal invoices (8 days before renewal) ─
  cron.schedule('45 8 * * *', async () => {
    await runAutoRenewalInvoices();
  });

  // Run once on server start so users don't have to wait for 8:45 schedule.
  runAutoRenewalInvoices();

  console.log('✅ Cron jobs registered');
};
