const Client = require('../models/Client');

/** Roles that may view and manage all clients (not limited to assigned AM). */
const CLIENT_ADMIN_ROLES = ['super_admin', 'admin'];

function isClientAdmin(user) {
  return user && CLIENT_ADMIN_ROLES.includes(user.role);
}

/** True if the client document’s assigned AM matches the user. */
function clientAssignedAmEquals(userId, client) {
  if (!client) return false;
  const raw = client.assignedAM;
  const id = raw && raw._id != null ? raw._id : raw;
  return id != null && String(id) === String(userId);
}

/** All client ObjectIds where this user is the assigned account manager. */
async function clientIdsForAssignedAm(userId) {
  return Client.find({ assignedAM: userId }).distinct('_id');
}

module.exports = {
  CLIENT_ADMIN_ROLES,
  isClientAdmin,
  clientAssignedAmEquals,
  clientIdsForAssignedAm,
};
