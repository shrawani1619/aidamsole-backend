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
  /** Primary department (synced from first entry in departmentMemberships when that array is set). */
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  /** Role in primary department (synced from first membership). */
  departmentRole: { type: String, default: '' }, // e.g. SEO Executive, Ads Manager
  /** One row per department: role can differ per department. */
  departmentMemberships: [{
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    role: { type: String, default: '' },
  }],
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  fcmToken: { type: String, default: '' },
  preferences: {
    notifications: { type: Boolean, default: true },
    emailAlerts: { type: Boolean, default: true }
  },
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpires: { type: Date },
  /** Admin overrides merged with role defaults — see utils/modulePermissions.js */
  modulePermissions: { type: mongoose.Schema.Types.Mixed, default: undefined },
  /** Soft-delete (trash) — excluded from team list; login blocked */
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.pre('save', function (next) {
  const m = this.departmentMemberships;
  if (Array.isArray(m) && m.length > 0) {
    this.departmentId = m[0].departmentId;
    this.departmentRole = m[0].role || '';
  } else if (this.isModified('departmentMemberships')) {
    this.departmentId = null;
    this.departmentRole = '';
  }
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
