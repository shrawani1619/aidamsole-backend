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
async function initDatabase() {
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
