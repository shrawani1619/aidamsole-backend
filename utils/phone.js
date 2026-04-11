function digitCount(n) {
  if (n === 0) return 1;
  return Math.floor(Math.log10(n)) + 1;
}

/**
 * Normalize phone for storage as Number (max 10 digits). Optional field → null.
 * @param {unknown} val
 * @returns {{ ok: true, value: number|null } | { ok: false, message: string }}
 */
function parsePhone(val) {
  if (val === undefined || val === null) return { ok: true, value: null };
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) return { ok: false, message: 'Phone must be a valid number' };
    if (!Number.isInteger(val)) return { ok: false, message: 'Phone must be a whole number' };
    const dc = digitCount(val);
    if (dc > 10) return { ok: false, message: 'Phone must be at most 10 digits' };
    if (val === 0) return { ok: true, value: null };
    return { ok: true, value: val };
  }
  const trimmed = String(val).trim();
  if (trimmed === '') return { ok: true, value: null };
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return { ok: false, message: 'Phone must contain only digits' };
  if (digits.length > 10) return { ok: false, message: 'Phone must be at most 10 digits' };
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return { ok: false, message: 'Phone must be at most 10 digits' };
  return { ok: true, value: n };
}

module.exports = { parsePhone };
