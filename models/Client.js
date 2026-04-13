const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  company: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true },
  phone: {
    type: Number,
    default: null,
    validate: {
      validator(v) {
        if (v === null || v === undefined) return true;
        if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) return false;
        const len = String(v).length;
        return len >= 1 && len <= 10;
      },
      message: 'Phone must be a whole number with at most 10 digits',
    },
  },
  website: { type: String, default: '' },
  industry: { type: String, default: '' },
  logo: { type: String, default: '' },
  address: {
    street: String, city: String, state: String, country: String, pincode: String
  },
  assignedAM: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  /** Delivery / ops owner — sees the same client as the account manager when set */
  projectManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  services: [{
    type: String,
    enum: ['SEO', 'Paid Ads', 'Social Media', 'Web Dev', 'Email Marketing', 'Content', 'Other']
  }],
  status: {
    type: String,
    enum: ['lead', 'onboarding', 'active', 'at_risk', 'paused', 'churned'],
    default: 'lead'
  },
  healthScore: {
    overall: { type: Number, default: 8, min: 1, max: 10 },
    engagement: { type: Number, default: 8 },
    results: { type: Number, default: 8 },
    payment: { type: Number, default: 8 },
    sentiment: { type: Number, default: 8 },
    lastUpdated: { type: Date, default: Date.now }
  },
  contractValue: { type: Number, default: 0 },
  contractStart: { type: Date },
  contractEnd: { type: Date },
  renewalDate: { type: Date },
  notes: { type: String, default: '' },
  tags: [String],
  onboardingCompleted: { type: Boolean, default: false },
  onboardingDate: { type: Date },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
  goals: [String],
  competitors: [String],
  timezone: { type: String, default: 'Asia/Kolkata' },
  communicationChannel: { type: String, enum: ['slack', 'whatsapp', 'email'], default: 'email' }
}, { timestamps: true });

clientSchema.index({ status: 1, assignedAM: 1 });
clientSchema.index({ projectManager: 1 });
clientSchema.index({ 'healthScore.overall': 1 });

module.exports = mongoose.model('Client', clientSchema);
