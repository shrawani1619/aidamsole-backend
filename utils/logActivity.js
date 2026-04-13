const ActivityLog = require('../models/ActivityLog');

/**
 * Best-effort audit row for the History module. Does not throw to callers.
 */
async function logActivity({ actorId, action, targetType, targetId, label, meta }) {
  try {
    if (!actorId || !action || !targetType) return;
    await ActivityLog.create({
      actorId,
      action,
      targetType,
      targetId: targetId || null,
      label: label || '',
      meta: meta && typeof meta === 'object' ? meta : {},
    });
  } catch (e) {
    console.error('[logActivity]', e.message || e);
  }
}

module.exports = { logActivity };
