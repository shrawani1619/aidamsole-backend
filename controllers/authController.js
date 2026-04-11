const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { resolveModulePermissions } = require('../utils/modulePermissions');
const { parsePhone } = require('../utils/phone');
const { hashToken, setPasswordResetToken, clearPasswordResetFields } = require('../utils/passwordReset');
const { sendPasswordResetEmail } = require('../utils/email');

function generateToken(id) {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET is not set on the server (add it in Render → Environment)');
  }
  return jwt.sign({ id }, secret, { expiresIn: process.env.JWT_EXPIRE || '7d' });
}

// @POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const user = await User.findOne({ email }).select('+password').populate('departmentId', 'name slug color');
    if (!user || !user.isActive)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const effectiveModulePermissions = resolveModulePermissions(user);
    res.json({
      success: true,
      token: generateToken(user._id),
      user: {
        _id: user._id, name: user.name, email: user.email, role: user.role,
        avatar: user.avatar, departmentId: user.departmentId, departmentRole: user.departmentRole,
        modulePermissions: user.modulePermissions,
        effectiveModulePermissions,
      }
    });
  } catch (err) {
    console.error('[auth/login]', err.message || err);
    res.status(500).json({ success: false, message: err.message || 'Login failed' });
  }
};

// @GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('departmentId', 'name slug color icon');
    const u = user.toObject ? user.toObject() : user;
    u.effectiveModulePermissions = resolveModulePermissions(user);
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/auth/update-password
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.matchPassword(currentPassword)))
      return res.status(400).json({ success: false, message: 'Current password incorrect' });

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password updated', token: generateToken(user._id) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/auth/forgot-password  (public)
exports.forgotPassword = async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const msg =
      'If an account exists for this email, you will receive a link to reset your password shortly.';
    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      return res.json({ success: true, message: msg });
    }

    const raw = await setPasswordResetToken(user._id);
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(raw)}`;
    const sent = await sendPasswordResetEmail(user, resetUrl);
    if (!sent.success) {
      console.error('[forgot-password] Email failed:', sent.error);
      return res.status(500).json({
        success: false,
        message: 'Could not send email. Ask your admin to configure SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS).',
      });
    }
    return res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/auth/reset-password  (public — token from email)
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const hash = hashToken(String(token).trim());
    const user = await User.findOne({
      passwordResetTokenHash: hash,
      passwordResetExpires: { $gt: new Date() },
    }).select('+password');
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired link. Request a new password reset from the login page.',
      });
    }
    user.password = newPassword;
    clearPasswordResetFields(user);
    await user.save();
    res.json({ success: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/auth/update-profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, avatar } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (avatar !== undefined) update.avatar = typeof avatar === 'string' ? avatar.trim() : '';
    if (phone !== undefined) {
      const p = parsePhone(phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      update.phone = p.value;
    }
    if (Object.keys(update).length === 0) {
      const user = await User.findById(req.user._id).populate('departmentId', 'name slug color icon');
      const u = user.toObject ? user.toObject() : user;
      u.effectiveModulePermissions = resolveModulePermissions(user);
      return res.json({ success: true, user: u });
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true })
      .populate('departmentId', 'name slug color icon');
    const u = user.toObject ? user.toObject() : user;
    u.effectiveModulePermissions = resolveModulePermissions(user);
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
