/** Parses "1,23,456.50", "₹ 1,200", "Rs. 12.5", "(100)" or "100.00 Cr"; null when it is not a number. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[₹,\s]|rs\.?|inr/gi, '').replace(/^[()\-+]+|[()]+$/g, '').replace(/%$/, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD and "12 Mar 2026". Returns ISO date or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ ,-]+(\d{4})$/.exec(s))) {
    const idx = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(r[2].toLowerCase());
    if (idx < 0) return null;
    [d, m, y] = [+r[1], idx + 1, +r[3]];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
