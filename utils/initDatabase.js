const mongoose = require('mongoose');

/** Load every Mongoose model so schemas are registered. */
function getModels() {
  const { Conversation, Message } = require('../models/Chat');
  return [
    require('../models/User'),
    require('../models/Department'),
    require('../models/Client'),
    require('../models/Project'),
    require('../models/Task'),
    require('../models/Invoice'),
    require('../models/Report'),
    require('../models/Notification'),
    Conversation,
    Message,
  ];
}

/**
 * Syncs indexes from each model (creates collections implicitly when needed).
 * We avoid explicit createCollection() — many hosted MongoDB users lack that
 * permission even when readWrite + createIndex works.
 */
/** Legacy projects stored `service` as a string; schema expects an array of services. */
async function migrateProjectServiceToArray() {
  const col = mongoose.connection.collection('projects');
  const n = await col.countDocuments({ service: { $type: 'string' } });
  if (!n) return;
  const docs = await col.find({ service: { $type: 'string' } }).toArray();
  for (const doc of docs) {
    await col.updateOne({ _id: doc._id }, { $set: { service: [doc.service] } });
  }
  console.log(`✅ Migrated ${n} project document(s): service string → string[]`);
}

async function initDatabase() {
  await migrateProjectServiceToArray();

  const models = getModels();
  const settled = await Promise.allSettled(models.map((Model) => Model.syncIndexes()));

  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      const name = models[i].collection?.name || models[i].modelName;
      console.warn(`⚠️  Index sync skipped for "${name}": ${result.reason?.message || result.reason}`);
    }
  });

  const ok = settled.filter((r) => r.status === 'fulfilled').length;
  if (ok === settled.length) {
    console.log(`✅ Model indexes synced (${ok} collections)`);
  } else {
    console.warn(`⚠️  Index sync partial (${ok}/${settled.length}). Collections appear on first write.`);
  }

  try {
    const cols = await mongoose.connection.db.listCollections().toArray();
    if (cols.length) {
      console.log(`   Collections present: ${cols.map((c) => c.name).sort().join(', ')}`);
    }
  } catch (err) {
    console.warn('   (Could not list collections)', err.message);
  }
}

module.exports = initDatabase;
