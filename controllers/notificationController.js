const Notification = require('../models/Notification');

// @GET /api/notifications
exports.getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = { userId: req.user._id };
    if (req.query.unread === 'true') filter.isRead = false;

    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments({ userId: req.user._id, isRead: false }),
      Notification.countDocuments(filter)
    ]);

    res.json({
      success: true,
      notifications,
      unreadCount,
      total,
      page,
      pages: Math.ceil(total / limit) || 1
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/notifications/:id/read
exports.markRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/notifications/mark-all-read
exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/notifications/:id
exports.deleteNotification = async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
