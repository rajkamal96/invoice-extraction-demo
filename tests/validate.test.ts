import { describe, expect, it } from 'vitest';
import type { InvoiceForm } from '../src/lib/invoice';
import { toForm } from '../src/lib/schema';
import { errorCount, validateInvoice } from '../src/lib/validate';
import { SAMPLES } from '../src/generated/samples';

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!;
const TODAY = new Date('2026-10-31T00:00:00Z');
const form = (id: string, recorded = false): InvoiceForm => {
  const s = sample(id);
  return toForm(recorded ? s.recorded : (JSON.parse(JSON.stringify(s.recorded)) as typeof s.recorded));
};
const errors = (inv: InvoiceForm) => validateInvoice(inv, { today: TODAY }).filter((i) => i.severity === 'error');
const clone = (i: InvoiceForm): InvoiceForm => JSON.parse(JSON.stringify(i));

describe('validateInvoice on the clean samples', () => {
  it('has no errors for the same-state invoice', () => expect(errors(form('clean-intra-state'))).toEqual([]));
  it('has no errors for the other-state invoice', () => expect(errors(form('clean-inter-state'))).toEqual([]));
});

describe('single-field errors are caught', () => {
  const base = () => clone(form('clean-intra-state'));
  const fieldsOf = (inv: InvoiceForm) => errors(inv).map((e) => e.field);

  it('misread GSTIN character', () => {
    const inv = base();
    inv.supplierGstin = inv.supplierGstin.slice(0, 5) + '9' + inv.supplierGstin.slice(6);
    expect(fieldsOf(inv)).toContain('supplierGstin');
  });
  it('wrong rate (quantity × rate no longer equals taxable value)', () => {
    const inv = base();
    inv.lines[0].rate = '295';
    expect(fieldsOf(inv)).toContain('lines.0.taxable');
  });
  it('wrong tax amount for the rate', () => {
    const inv = base();
    inv.lines[1].cgst = '94.40';
    expect(fieldsOf(inv)).toContain('lines.1.gstRate');
  });
  it('wrong grand total', () => {
    const inv = base();
    inv.totals.grandTotal = '18999';
    expect(fieldsOf(inv)).toContain('totals.grandTotal');
  });
  it('line sum differs from the document total', () => {
    const inv = base();
    inv.totals.taxable = '16000.00';
    expect(fieldsOf(inv)).toContain('totals.taxable');
  });
  it('IGST charged on a same-state sale', () => {
    const inv = base();
    inv.lines[0].igst = inv.lines[0].cgst;
    expect(fieldsOf(inv)).toContain('lines.0.igst');
  });
  it('CGST/SGST charged on an other-state sale', () => {
    const inv = clone(form('clean-inter-state'));
    inv.placeOfSupply = 'Karnataka (29)';
    expect(errors(inv).some((e) => e.message.includes('same state'))).toBe(true);
    const inv2 = clone(form('clean-inter-state'));
    inv2.lines[0].cgst = '10';
    expect(errors(inv2).some((e) => e.field === 'lines.0.cgst')).toBe(true);
  });
  it('bad HSN length, bad date, missing fields', () => {
    const inv = base();
    inv.lines[0].hsn = '480';
    inv.invoiceDate = '31/02/2026';
    inv.invoiceNumber = '';
    expect(fieldsOf(inv)).toEqual(expect.arrayContaining(['lines.0.hsn', 'invoiceDate', 'invoiceNumber']));
  });
  it('flags future dates and non-standard GST rates as warnings, not errors', () => {
    const inv = base();
    inv.invoiceDate = '01/01/2030';
    inv.lines[0].gstRate = '13';
    const issues = validateInvoice(inv, { today: TODAY });
    expect(issues.find((i) => i.field === 'invoiceDate')?.severity).toBe('warning');
    expect(issues.find((i) => i.field === 'lines.0.gstRate' && i.message.includes('standard'))?.severity).toBe('warning');
  });
});

describe('the recorded "needs review" sample', () => {
  it('flags the misread GSTIN, the misread rate and the wrong tax type', () => {
    const inv = form('needs-review', true);
    const fields = errors(inv).map((e) => e.field);
    expect(fields).toContain('supplierGstin');
    expect(fields).toContain('lines.1.taxable');
    expect(fields.some((f) => f.endsWith('.cgst') || f.endsWith('.sgst'))).toBe(true); // CGST/SGST on an other-state sale
    expect(errorCount(validateInvoice(inv, { today: TODAY }))).toBeGreaterThanOrEqual(3);
  });
});

describe('model-reported uncertainty', () => {
  it('becomes a warning on that field', () => {
    const issues = validateInvoice(form('clean-intra-state'), { uncertain: ['lines.0.rate'], today: TODAY });
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', field: 'lines.0.rate' }));
  });
});

describe('edge cases', () => {
  it('does not throw on an empty form', () => {
    expect(() => validateInvoice({ supplierName: '', supplierGstin: '', buyerName: '', buyerGstin: '', invoiceNumber: '', invoiceDate: '', placeOfSupply: '', lines: [], totals: { taxable: '', cgst: '', sgst: '', igst: '', roundOff: '', grandTotal: '' } })).not.toThrow();
  });
  it('tolerates ±₹1 rounding per line', () => {
    const inv = clone(form('clean-intra-state'));
    inv.lines[2].cgst = '242.74';
    expect(errors(inv).filter((e) => e.field === 'lines.2.gstRate')).toEqual([]);
  });
});
