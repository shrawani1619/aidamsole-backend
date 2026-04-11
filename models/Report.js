const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['client_performance', 'team_performance', 'financial', 'operational', 'retention'],
    required: true
  },
  range: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'],
    required: true
  },
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cacheExpiry: { type: Date, default: () => new Date(Date.now() + 60 * 60 * 1000) }, // 1hr default
  isScheduled: { type: Boolean, default: false },
  shareToken: { type: String, unique: true, sparse: true }
}, { timestamps: true });

reportSchema.index({ type: 1, range: 1, cacheExpiry: 1 });

module.exports = mongoose.model('Report', reportSchema);
