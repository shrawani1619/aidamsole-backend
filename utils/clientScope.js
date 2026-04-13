const Client = require('../models/Client');

/** Roles that may view and manage all clients (not limited to assigned AM). */
const CLIENT_ADMIN_ROLES = ['super_admin', 'admin'];

function isClientAdmin(user) {
  return user && CLIENT_ADMIN_ROLES.includes(user.role);
}

function idFromRef(raw) {
  if (raw == null) return null;
  return raw._id != null ? raw._id : raw;
}

/** True if the client’s assigned account manager matches the user. */
function clientAssignedAmEquals(userId, client) {
  const id = idFromRef(client?.assignedAM);
  return id != null && String(id) === String(userId);
}

/** True if the client’s project manager matches the user. */
function clientProjectManagerEquals(userId, client) {
  const id = idFromRef(client?.projectManager);
  return id != null && String(id) === String(userId);
}

/** Account manager or project manager (or either role on a plain lean object). */
function userHasClientAccess(userId, client) {
  if (!client || userId == null) return false;
  return clientAssignedAmEquals(userId, client) || clientProjectManagerEquals(userId, client);
}

/** All client ObjectIds where this user is assigned AM or project manager. */
async function clientIdsForAssignedAm(userId) {
  return Client.find({
    $or: [{ assignedAM: userId }, { projectManager: userId }],
  }).distinct('_id');
}

module.exports = {
  CLIENT_ADMIN_ROLES,
  isClientAdmin,
  clientAssignedAmEquals,
  clientProjectManagerEquals,
  userHasClientAccess,
  clientIdsForAssignedAm,
};
