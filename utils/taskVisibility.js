const mongoose = require('mongoose');

/** All BSON variants of a user id (fixes assignee list queries that miss string vs ObjectId) */
function participantIdVariants(userId) {
  const s = String(userId);
  const out = new Set([userId, s]);
  if (mongoose.Types.ObjectId.isValid(s)) {
    try {
      out.add(new mongoose.Types.ObjectId(s));
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

/** Plain Mongo matchers (reliable across drivers) */
function participantMatchBranches(userId) {
  const idList = participantIdVariants(userId);
  return [
    { assigneeId: { $in: idList } },
    { assigneeIds: { $in: idList } },
    { reviewerId: { $in: idList } },
    { reviewerIds: { $in: idList } },
    { createdBy: { $in: idList } },
    { 'subtasks.assigneeId': { $in: idList } },
    { 'subtasks.reviewerId': { $in: idList } },
  ];
}

function idToStringExpr(fieldRef) {
  return { $convert: { input: fieldRef, to: 'string', onError: '', onNull: '' } };
}

/** Extra safety net for odd stored types */
function participantVisibilityExpr(uidStr) {
  return {
    $expr: {
      $or: [
        { $eq: [uidStr, idToStringExpr('$assigneeId')] },
        {
          $in: [
            uidStr,
            {
              $map: {
                input: { $ifNull: ['$assigneeIds', []] },
                as: 'a',
                in: idToStringExpr('$$a'),
              },
            },
          ],
        },
        { $eq: [uidStr, idToStringExpr('$reviewerId')] },
        {
          $in: [
            uidStr,
            {
              $map: {
                input: { $ifNull: ['$reviewerIds', []] },
                as: 'r',
                in: idToStringExpr('$$r'),
              },
            },
          ],
        },
        { $eq: [uidStr, idToStringExpr('$createdBy')] },
        {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ['$subtasks', []] },
                  as: 'st',
                  cond: {
                    $or: [
                      { $eq: [uidStr, idToStringExpr('$$st.assigneeId')] },
                      { $eq: [uidStr, idToStringExpr('$$st.reviewerId')] },
                    ],
                  },
                },
              },
            },
            0,
          ],
        },
      ],
    },
  };
}

/**
 * Non–client-admin task visibility: AM/PM clients, tasks on projects where the user is on team,
 * OR assignee/reviewer/creator/subtask participation.
 * Use inside filter: filter.$and = [..., buildEmployeeTaskVisibilityOr(userId, myClientIds, teamProjectIds)]
 */
function buildEmployeeTaskVisibilityOr(userId, myClientIds, teamProjectIds = []) {
  const uidStr = String(userId);
  const orBranches = [...participantMatchBranches(userId), participantVisibilityExpr(uidStr)];
  if (myClientIds?.length) {
    orBranches.push({ clientId: { $in: myClientIds } });
  }
  if (teamProjectIds?.length) {
    orBranches.push({ projectId: { $in: teamProjectIds } });
  }
  return { $or: orBranches };
}

module.exports = {
  participantIdVariants,
  participantMatchBranches,
  participantVisibilityExpr,
  buildEmployeeTaskVisibilityOr,
};
