const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Super admin always has full access — never block them
const SUPER_ROLES = ['super_admin', 'admin'];

exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).populate('departmentId');
    if (!req.user || !req.user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Not authorized, invalid token' });
  }
};

// authorize: super_admin and admin ALWAYS pass — no 403 ever for them
exports.authorize = (...roles) => (req, res, next) => {
  // Super admin and admin always have full access
  if (SUPER_ROLES.includes(req.user.role)) return next();
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: `Access denied for role '${req.user.role}'` });
  }
  next();
};

// departmentScope: controls what data is visible — super_admin sees ALL
exports.departmentScope = (req, res, next) => {
  const role = req.user.role;
  if (SUPER_ROLES.includes(role)) {
    req.scopeAll = true;
  } else if (role === 'department_manager') {
    req.scopeAll = false;
    req.scopeDepartment = req.user.departmentId?._id || null;
  } else {
    req.scopeAll = false;
    req.scopeUser = req.user._id;
    req.scopeDepartment = req.user.departmentId?._id || null;
  }
  next();
};
