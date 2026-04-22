const Client = require('../models/Client');
const Project = require('../models/Project');

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

/** True if user is listed on `project.team` (ObjectIds or populated users). */
function userOnProjectTeam(userId, project) {
  if (!project || userId == null || !Array.isArray(project.team) || project.team.length === 0) {
    return false;
  }
  const uid = String(userId);
  return project.team.some((m) => {
    const id = m != null && typeof m === 'object' && m._id != null ? m._id : m;
    return id != null && String(id) === uid;
  });
}

/**
 * Read access to a project document: super_admin/admin handled in controllers via isClientAdmin;
 * otherwise assigned AM / project manager on client, or member of project.team.
 */
function userHasProjectViewAccess(userId, project) {
  if (!project || userId == null) return false;
  if (userOnProjectTeam(userId, project)) return true;
  return !!(project.clientId && userHasClientAccess(userId, project.clientId));
}

/** DB lookup: user appears on this project’s team (for task list / canAccessTask). */
async function userIsMemberOfProjectTeam(userId, projectId) {
  if (!userId || !projectId) return false;
  const id = projectId._id != null ? projectId._id : projectId;
  const doc = await Project.findOne({ _id: id, team: userId }).select('_id').lean();
  return !!doc;
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
  userOnProjectTeam,
  userHasProjectViewAccess,
  userIsMemberOfProjectTeam,
  clientIdsForAssignedAm,
};
