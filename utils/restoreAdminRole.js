/**
 * One-shot: set admin@aidamsole.com back to super_admin (e.g. after dept head assignment demoted role).
 * Usage: npm run fix-admin-role   (from backend/)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/aidamsole';
const EMAIL = 'admin@aidamsole.com';

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const res = await User.updateOne(
      { email: EMAIL },
      { $set: { role: 'super_admin', departmentRole: 'Founder & Super Admin' } }
    );
    if (res.matchedCount === 0) {
      console.error(`No user found with email ${EMAIL}`);
      process.exit(1);
    }
    console.log(`Updated ${EMAIL} → role super_admin (${res.modifiedCount} document modified)`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
