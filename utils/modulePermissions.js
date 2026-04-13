/**
 * Module-based ACL: view / create / edit / delete per area, plus optional field-level view (dashboard).
 * super_admin: full access. admin: same as full except History off by default (grant via per-user modulePermissions).
 */

const MODULE_IDS = [
  'dashboard',
  'clients',
  'projects',
  'tasks',
  'departments',
  'team',
  'reports',
  'finance',
  'chat',
  'trash',
  'history',
  /** Super admin only (enforced in middleware) — manage administrator accounts */
  'admins',
];

const ACTIONS = ['view', 'create', 'edit', 'delete'];

/** Dashboard insight widgets (field-level deny with fields.mrr === false, etc.) */
const DASHBOARD_FIELD_KEYS = [
  'mrr',
  'activeClients',
  'thisMonthRevenue',
  'delayedTasks',
  'clientHealth',
  'deptPerformance',
  'riskClients',
  'topClients',
  'revenueHistory',
];

/** Reports page tabs / sections (field-level) — aligned with ReportsPage tab values */
const REPORTS_FIELD_KEYS = ['financial', 'client', 'team', 'operational'];

function emptyModule(perms) {
  return { view: false, create: false, edit: false, delete: false, fields: {}, ...perms };
}

function allTrueFields() {
  const o = {};
  DASHBOARD_FIELD_KEYS.forEach((k) => {
    o[k] = true;
  });
  return o;
}

function allReportsFields() {
  const o = {};
  REPORTS_FIELD_KEYS.forEach((k) => {
    o[k] = true;
  });
  return o;
}

function fullAccess() {
  const out = {};
  MODULE_IDS.forEach((id) => {
    let fields = {};
    if (id === 'dashboard') fields = allTrueFields();
    else if (id === 'reports') fields = allReportsFields();
    out[id] = emptyModule({
      view: true,
      create: true,
      edit: true,
      delete: true,
      fields,
    });
  });
  return out;
}

/** Admin role: all modules on except History (super_admin-only unless explicitly granted per user). */
function adminDefaultAccess() {
  const fa = fullAccess();
  fa.history = emptyModule({ view: false, create: false, edit: false, delete: false });
  fa.admins = emptyModule({ view: false, create: false, edit: false, delete: false });
  return fa;
}

/** Baseline when user.modulePermissions is absent — mirrors previous role-based UX */
function defaultsForRole(role) {
  if (role === 'super_admin') return fullAccess();
  if (role === 'admin') return adminDefaultAccess();

  const out = {};
  MODULE_IDS.forEach((id) => {
    out[id] = emptyModule();
  });

  const dashFields = {
    ...allTrueFields(),
    mrr: false, // employees: hide MRR by default; admin can enable per user
  };

  if (role === 'department_manager') {
    out.dashboard = emptyModule({
      view: true,
      fields: allTrueFields(),
    });
    out.clients = emptyModule({ view: true, create: true, edit: true, delete: false });
    out.projects = emptyModule({ view: true, create: true, edit: true, delete: false });
    out.tasks = emptyModule({ view: true, create: true, edit: true, delete: true });
    out.departments = emptyModule({ view: false });
    out.team = emptyModule({ view: true, create: true, edit: true, delete: false });
    out.reports = emptyModule({ view: true, create: false, edit: false, delete: false, fields: allReportsFields() });
    out.finance = emptyModule({ view: false });
    out.chat = emptyModule({ view: true, create: true, edit: false, delete: false });
    out.trash = emptyModule({ view: false });
    return out;
  }

  // employee
  out.dashboard = emptyModule({ view: true, fields: dashFields });
  out.clients = emptyModule({ view: true, create: false, edit: false, delete: false });
  out.projects = emptyModule({ view: true, create: false, edit: false, delete: false });
  out.tasks = emptyModule({ view: true, create: true, edit: true, delete: false });
  out.departments = emptyModule({ view: false });
  out.team = emptyModule({ view: false });
  out.reports = emptyModule({ view: true, create: false, edit: false, delete: false, fields: allReportsFields() });
  out.finance = emptyModule({ view: false });
  out.chat = emptyModule({ view: true, create: true, edit: false, delete: false });
  out.trash = emptyModule({ view: false });
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMergeModule(base, patch) {
  if (!isPlainObject(patch)) return base;
  const next = { ...base, ...patch };
  if (isPlainObject(base.fields) || isPlainObject(patch.fields)) {
    next.fields = { ...(base.fields || {}), ...(patch.fields || {}) };
  }
  ACTIONS.forEach((a) => {
    if (typeof patch[a] === 'boolean') next[a] = patch[a];
  });
  return next;
}

/**
 * Merge role defaults with user.modulePermissions overrides.
 */
function resolveModulePermissions(user) {
  if (!user) return fullAccess();
  const role = user.role || 'employee';
  if (role === 'super_admin') return fullAccess();

  if (role === 'admin') {
    const base = defaultsForRole('admin');
    const overrides = user.modulePermissions;
    if (!isPlainObject(overrides) || Object.keys(overrides).length === 0) {
      return base;
    }
    const out = { ...base };
    MODULE_IDS.forEach((id) => {
      if (overrides[id] !== undefined) {
        out[id] = deepMergeModule(base[id] || emptyModule(), overrides[id]);
      }
    });
    return out;
  }

  const base = defaultsForRole(role);
  const overrides = user.modulePermissions;
  if (!isPlainObject(overrides) || Object.keys(overrides).length === 0) {
    return base;
  }

  const out = { ...base };
  MODULE_IDS.forEach((id) => {
    if (overrides[id] !== undefined) {
      out[id] = deepMergeModule(base[id] || emptyModule(), overrides[id]);
    }
  });
  return out;
}

function hasModuleAction(resolved, moduleId, action) {
  if (!resolved || !moduleId || !action) return false;
  const m = resolved[moduleId];
  if (!m) return false;
  return m[action] === true;
}

/** Field-level: if fields.foo === false, deny. Missing field defaults to true when module view is true. */
function canViewModuleField(resolved, moduleId, fieldKey) {
  if (!resolved || !moduleId || !fieldKey) return false;
  const m = resolved[moduleId];
  if (!m || m.view !== true) return false;
  if (m.fields && m.fields[fieldKey] === false) return false;
  return true;
}

/**
 * Sanitize incoming PATCH from API — only known keys, booleans only.
 */
function sanitizeModulePermissions(input) {
  if (!isPlainObject(input)) return {};
  const out = {};
  MODULE_IDS.forEach((id) => {
    if (!isPlainObject(input[id])) return;
    const src = input[id];
    const entry = {};
    ACTIONS.forEach((a) => {
      if (typeof src[a] === 'boolean') entry[a] = src[a];
    });
    if (isPlainObject(src.fields)) {
      const fields = {};
      const fieldKeys = id === 'dashboard' ? DASHBOARD_FIELD_KEYS : id === 'reports' ? REPORTS_FIELD_KEYS : [];
      fieldKeys.forEach((fk) => {
        if (typeof src.fields[fk] === 'boolean') fields[fk] = src.fields[fk];
      });
      if (Object.keys(fields).length) entry.fields = fields;
    }
    if (Object.keys(entry).length) out[id] = entry;
  });
  return out;
}

module.exports = {
  MODULE_IDS,
  ACTIONS,
  DASHBOARD_FIELD_KEYS,
  REPORTS_FIELD_KEYS,
  resolveModulePermissions,
  hasModuleAction,
  canViewModuleField,
  sanitizeModulePermissions,
  defaultsForRole,
  fullAccess,
  adminDefaultAccess,
};
