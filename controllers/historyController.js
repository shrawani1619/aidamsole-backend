const ActivityLog = require('../models/ActivityLog');

// @GET /api/history
exports.getHistory = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 40));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ActivityLog.find({})
        .populate('actorId', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments({}),
    ]);

    res.json({
      success: true,
      items,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
