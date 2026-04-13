const mongoose = require('mongoose');

function toOid(id) {
  if (!id) return null;
  const raw = id && id._id ? id._id : id;
  if (raw instanceof mongoose.Types.ObjectId) return raw;
  try {
    return new mongoose.Types.ObjectId(String(raw));
  } catch {
    return null;
  }
}

/** All department ObjectIds for a user (memberships first, else legacy departmentId). */
function departmentIdsFromUser(user) {
  const list = [];
  const mem = user.departmentMemberships || [];
  for (const m of mem) {
    const oid = toOid(m.departmentId);
    if (oid) list.push(oid);
  }
  if (list.length) {
    const seen = new Set();
    return list.filter((id) => {
      const s = String(id);
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  }
  const oid = toOid(user.departmentId);
  return oid ? [oid] : [];
}

/**
 * Mongo filter: user belongs to department `deptId` (legacy field or memberships).
 */
function userBelongsToDepartmentClause(deptId) {
  return {
    $or: [
      { departmentId: deptId },
      { 'departmentMemberships.departmentId': deptId },
    ],
  };
}

/**
 * Mongo filter: user belongs to any of `ids` (each is ObjectId or string).
 */
function userBelongsToAnyDepartmentClause(ids) {
  if (!ids || !ids.length) return {};
  const normalized = ids.map((id) => toOid(id)).filter(Boolean);
  if (!normalized.length) return {};
  if (normalized.length === 1) return userBelongsToDepartmentClause(normalized[0]);
  return {
    $or: [
      { departmentId: { $in: normalized } },
      { 'departmentMemberships.departmentId': { $in: normalized } },
    ],
  };
}

/**
 * For models with a single `departmentId` field (Task, Project): scope to one or many depts.
 */
function singleRefDepartmentFilter(ids) {
  if (!ids || !ids.length) return {};
  if (ids.length === 1) return { departmentId: toOid(ids[0]) };
  return { departmentId: { $in: ids.map(toOid).filter(Boolean) } };
}

module.exports = {
  toOid,
  departmentIdsFromUser,
  userBelongsToDepartmentClause,
  userBelongsToAnyDepartmentClause,
  singleRefDepartmentFilter,
};
