const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Department = require('../models/Department');
const { parsePhone } = require('../utils/phone');

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

    res.json({
      success: true,
      token: generateToken(user._id),
      user: {
        _id: user._id, name: user.name, email: user.email, role: user.role,
        avatar: user.avatar, departmentId: user.departmentId, departmentRole: user.departmentRole
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
    res.json({ success: true, user });
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

// @PUT /api/auth/update-profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, avatar } = req.body;
    const update = { name };
    if (avatar !== undefined) update.avatar = avatar;
    if (phone !== undefined) {
      const p = parsePhone(phone);
      if (!p.ok) return res.status(400).json({ success: false, message: p.message });
      update.phone = p.value;
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
