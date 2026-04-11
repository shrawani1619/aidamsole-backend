const mongoose = require('mongoose');

const SERVICE_ENUM = ['SEO', 'Paid Ads', 'Social Media', 'Web Dev', 'Email Marketing', 'Content', 'Other'];

const projectSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  team: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  service: {
    type: [{ type: String, enum: SERVICE_ENUM }],
    required: true,
    validate: {
      validator(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'At least one service is required',
    },
  },
  /** When `service` includes "Other", user-specified label (e.g. "Influencer marketing"). */
  serviceOtherDetail: { type: String, default: '', trim: true, maxlength: 200 },
  status: {
    type: String,
    enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
    default: 'planning'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  startDate: { type: Date },
  dueDate: { type: Date },
  completedDate: { type: Date },
  budget: { type: Number, default: 0 },
  spent: { type: Number, default: 0 },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  milestones: [{
    title: String,
    dueDate: Date,
    completed: { type: Boolean, default: false },
    completedDate: Date
  }],
  kpis: [{
    metric: String,
    target: Number,
    current: Number,
    unit: String
  }],
  tags: [String],
  attachments: [{
    filename: String,
    url: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

projectSchema.index({ clientId: 1, status: 1 });
projectSchema.index({ departmentId: 1, status: 1 });
projectSchema.index({ dueDate: 1 });

module.exports = mongoose.model('Project', projectSchema);
module.exports.SERVICE_ENUM = SERVICE_ENUM;
