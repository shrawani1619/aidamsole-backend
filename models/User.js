const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  avatar: { type: String, default: '' },
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
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'department_manager', 'employee'],
    default: 'employee'
  },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  departmentRole: { type: String, default: '' }, // e.g. SEO Executive, Ads Manager
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  fcmToken: { type: String, default: '' },
  preferences: {
    notifications: { type: Boolean, default: true },
    emailAlerts: { type: Boolean, default: true }
  }
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
