import { describe, expect, it } from 'vitest';
import { parseAmount, parseDate, round2 } from '../src/lib/amounts';
import { gstinCheckChar, stateCodeOf, validateGstin } from '../src/lib/gstin';

describe('GSTIN', () => {
  it('accepts numbers with a correct checksum (two commonly quoted examples and generated ones)', () => {
    for (const g of ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4']) expect(validateGstin(g)).toMatchObject({ ok: true });
    const first14 = '27AABCS4412Q1Z';
    expect(validateGstin(first14 + gstinCheckChar(first14)).ok).toBe(true);
  });
  it('ignores spaces and case', () => {
    expect(validateGstin(' 27aapfu0939f1zv ').ok).toBe(true);
  });
  it('catches every single-character misread of a valid number in the checksummed positions', () => {
    const good = '27AAPFU0939F1ZV';
    let caught = 0;
    let total = 0;
    for (let i = 0; i < 15; i++) {
      for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        if (c === good[i]) continue;
        total++;
        if (!validateGstin(good.slice(0, i) + c + good.slice(i + 1)).ok) caught++;
      }
    }
    expect(caught).toBe(total); // a weighted checksum + format rules reject every single substitution
  });
  it('explains the failure', () => {
    expect(validateGstin('27AAPFU0939F1ZX')).toMatchObject({ ok: false, problem: 'checksum' });
    expect(validateGstin('27AAPFU0939F1')).toMatchObject({ ok: false, problem: 'format' });
    expect(validateGstin('99AAPFU0939F1ZV')).toMatchObject({ ok: false, problem: 'state' });
    expect(validateGstin('27AAPXU0939F1ZV')).toMatchObject({ ok: false, problem: 'pan' });
  });
  it('maps state names and codes', () => {
    expect(stateCodeOf('Maharashtra (27)')).toBe('27');
    expect(stateCodeOf('27-Maharashtra')).toBe('27');
    expect(stateCodeOf('Delhi')).toBe('07');
    expect(stateCodeOf('Jammu & Kashmir')).toBe('01');
    expect(stateCodeOf('Atlantis')).toBeUndefined();
    expect(stateCodeOf('')).toBeUndefined();
  });
});

describe('amounts and dates', () => {
  it('parses Indian formats', () => {
    expect(parseAmount('1,23,456.50')).toBe(123456.5);
    expect(parseAmount('₹ 1,200')).toBe(1200);
    expect(parseAmount('Rs. 12.5')).toBe(12.5);
    expect(parseAmount('18%')).toBe(18);
    expect(parseAmount('(100)')).toBe(-100);
    expect(parseAmount('-0.26')).toBe(-0.26);
  });
  it('returns null for non-numbers', () => {
    for (const bad of ['', 'abc', '12abc', '1.2.3', null, undefined, '--']) expect(parseAmount(bad as never)).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
  });
  it('parses and rejects dates', () => {
    expect(parseDate('14/03/2026')).toBe('2026-03-14');
    expect(parseDate('14-3-2026')).toBe('2026-03-14');
    expect(parseDate('2026-03-14')).toBe('2026-03-14');
    expect(parseDate('14 Mar 2026')).toBe('2026-03-14');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
    expect(parseDate('14/03/26')).toBeNull();
  });
  it('rounds to paise', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });
});
