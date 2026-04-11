const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  color: { type: String, default: '#0D1B8E' },
  icon: { type: String, default: '' },
  headId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  /** Job titles / role names typical for this department (e.g. SEO Executive) */
  roles: [{ type: String, trim: true }],
  isActive: { type: Boolean, default: true },
  kpis: [{
    name: String,
    target: Number,
    unit: String
  }]
}, { timestamps: true });

departmentSchema.virtual('memberCount').get(function () {
  return this.members.length;
});

module.exports = mongoose.model('Department', departmentSchema);
