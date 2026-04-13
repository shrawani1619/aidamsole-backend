/**
 * Ensures admin@aidamsole.com can log in: set ADMIN_PASSWORD in .env (default admin123), super_admin, active.
 * Uses User.save() so password pre-hash runs. Creates user if missing.
 * Usage: npm run reset-admin-login   (from backend/)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/aidamsole';
const EMAIL = 'admin@aidamsole.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    let user = await User.findOne({ email: EMAIL });
    if (!user) {
      await User.create({
        name: 'Super Admin',
        email: EMAIL,
        password: PASSWORD,
        role: 'super_admin',
        departmentRole: 'Founder & Super Admin',
        isActive: true
      });
      console.log(`Created ${EMAIL} (password from ADMIN_PASSWORD or default; role: super_admin)`);
    } else {
      user.password = PASSWORD;
      user.role = 'super_admin';
      user.isActive = true;
      user.departmentRole = 'Founder & Super Admin';
      await user.save();
      console.log(`Reset ${EMAIL}: password, role super_admin, isActive true`);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
