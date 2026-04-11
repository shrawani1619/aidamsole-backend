/**
 * Converts legacy string `phone` fields to Number (max 10 digits) on users + clients.
 * Run once after schema change: npm run migrate-phones
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { parsePhone } = require('./phone');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/aidamsole';

async function migrateCollection(name) {
  const coll = mongoose.connection.collection(name);
  const docs = await coll.find({ phone: { $exists: true, $ne: null } }).toArray();
  let n = 0;
  for (const doc of docs) {
    if (typeof doc.phone !== 'string') continue;
    const p = parsePhone(doc.phone);
    await coll.updateOne({ _id: doc._id }, { $set: { phone: p.ok ? p.value : null } });
    n++;
  }
  console.log(`  ${name}: updated ${n} string → number`);
}

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    await migrateCollection('users');
    await migrateCollection('clients');
    console.log('Done.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
