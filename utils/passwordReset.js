const crypto = require('crypto');
const User = require('../models/User');

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/** Creates a one-hour reset token; returns raw token for URLs (store only hash in DB). */
async function setPasswordResetToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await User.findByIdAndUpdate(userId, {
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: expires,
  });
  return raw;
}

function clearPasswordResetFields(userDoc) {
  userDoc.passwordResetTokenHash = undefined;
  userDoc.passwordResetExpires = undefined;
}

module.exports = {
  hashToken,
  setPasswordResetToken,
  clearPasswordResetFields,
};
