// GSTIN structure: 2-digit state code + 10-character PAN + entity number + "Z" + check character.
// The check character is a base-36 weighted checksum, so most single-character misreads are caught
// without any model: that is the point of validating extraction output in code.

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, ' ').trim();
const BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [norm(name), code]));
BY_NAME.set('jammu and kashmir', '01');
BY_NAME.set('orissa', '21');
BY_NAME.set('pondicherry', '34');
BY_NAME.set('new delhi', '07');

/** "27", "27-Maharashtra", "Maharashtra (27)" or "Maharashtra" -> "27"; undefined if unknown. */
export function stateCodeOf(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const digits = /(?:^|\D)(\d{2})(?:\D|$)/.exec(t)?.[1];
  if (digits && STATES[digits]) return digits;
  return BY_NAME.get(norm(t.replace(/\(?\d{2}\)?/g, ' ')));
}

export function gstinCheckChar(first14: string): string | undefined {
  if (!/^[0-9A-Z]{14}$/.test(first14)) return undefined;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const prod = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export type GstinProblem = 'format' | 'state' | 'pan' | 'checksum';

export interface GstinResult {
  ok: boolean;
  problem?: GstinProblem;
  message?: string;
  stateCode?: string;
  pan?: string;
}

export function validateGstin(raw: string): GstinResult {
  const g = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
    return { ok: false, problem: 'format', message: 'A GSTIN has 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 character, "Z", 1 character.' };
  }
  const stateCode = g.slice(0, 2);
  if (!STATES[stateCode]) return { ok: false, problem: 'state', stateCode, message: `State code ${stateCode} is not a valid GST state code.` };
  const pan = g.slice(2, 12);
  if (!'ABCFGHLJPT'.includes(pan[3])) {
    return { ok: false, problem: 'pan', stateCode, pan, message: `The 4th character of the PAN inside the GSTIN ("${pan[3]}") is not a valid entity type.` };
  }
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) {
    return { ok: false, problem: 'checksum', stateCode, pan, message: 'The last character does not match the GSTIN checksum, so at least one character is probably misread.' };
  }
  return { ok: true, stateCode, pan };
}
