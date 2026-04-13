const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: {
    type: String,
    enum: ['todo', 'in_progress', 'review', 'approved', 'done', 'blocked'],
    default: 'todo'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  dueDate: { type: Date },
  estimatedHours: { type: Number, default: 0 },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date }
}, { timestamps: true });

const timeLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  startTime: Date,
  endTime: Date,
  duration: Number, // minutes
  note: String
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  /** @deprecated Prefer reviewerIds; kept for legacy tasks and first-reviewer denorm */
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['todo', 'in_progress', 'review', 'approved', 'done', 'blocked'],
    default: 'todo'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  dueDate: { type: Date },
  completedAt: { type: Date },
  estimatedHours: { type: Number, default: 0 },
  actualHours: { type: Number, default: 0 },
  subtasks: [subtaskSchema],
  timeLogs: [timeLogSchema],
  attachments: [{
    filename: String,
    url: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  comments: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
    createdAt: { type: Date, default: Date.now }
  }],
  tags: [String],
  twoEyeApproved: { type: Boolean, default: false },
  twoEyeApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isDelayed: { type: Boolean, default: false },
  revisionCount: { type: Number, default: 0 },
  /** Soft-delete (trash) — excluded from task lists */
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeId: 1, status: 1, dueDate: 1 });
taskSchema.index({ departmentId: 1, status: 1 });
taskSchema.index({ reviewerIds: 1 });
taskSchema.index({ dueDate: 1, isDelayed: 1 });

// Auto-flag delayed tasks
taskSchema.pre('save', function (next) {
  if (this.dueDate && this.status !== 'done' && this.status !== 'approved') {
    this.isDelayed = new Date() > this.dueDate;
  }
  next();
});

module.exports = mongoose.model('Task', taskSchema);
