import { parseAmount, parseDate, round2 } from './amounts';
import { stateCodeOf, validateGstin } from './gstin';
import type { InvoiceForm, Issue } from './invoice';

const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
const TOL = 1.0; // rupees: invoices round per line, so tiny differences are normal

export interface ValidateOptions {
  /** Fields the model said it could not read clearly (same paths as Issue.field). */
  uncertain?: string[];
  /** Injectable for tests. */
  today?: Date;
}

const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;

/** Deterministic checks. Everything here runs in code, so it behaves the same for every input. */
export function validateInvoice(inv: InvoiceForm, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], field: string, message: string) => issues.push({ severity, field, message });

  for (const f of opts.uncertain ?? []) add('warning', f, 'The model said it was unsure about this field. Check it against the document.');

  if (!inv.supplierName.trim()) add('error', 'supplierName', 'Supplier name is missing.');
  if (!inv.invoiceNumber.trim()) add('error', 'invoiceNumber', 'Invoice number is missing.');

  // Supplier / buyer GSTIN
  const sup = inv.supplierGstin.trim() ? validateGstin(inv.supplierGstin) : null;
  if (!sup) add('error', 'supplierGstin', 'Supplier GSTIN is missing.');
  else if (!sup.ok) add('error', 'supplierGstin', sup.message ?? 'Invalid GSTIN.');
  const buy = inv.buyerGstin.trim() ? validateGstin(inv.buyerGstin) : null;
  if (buy && !buy.ok) add('error', 'buyerGstin', buy.message ?? 'Invalid GSTIN.');
  if (!buy) add('warning', 'buyerGstin', 'No buyer GSTIN (fine for a sale to a consumer; the buyer cannot claim input tax credit).');

  // Date
  const iso = inv.invoiceDate.trim() ? parseDate(inv.invoiceDate) : null;
  if (!inv.invoiceDate.trim()) add('error', 'invoiceDate', 'Invoice date is missing.');
  else if (!iso) add('error', 'invoiceDate', 'Could not read this as a date (use DD/MM/YYYY).');
  else if (new Date(iso) > (opts.today ?? new Date())) add('warning', 'invoiceDate', 'The invoice date is in the future.');

  // Supply type: same state -> CGST + SGST, different state -> IGST.
  const supState = sup?.stateCode ?? stateCodeOf(inv.supplierGstin.slice(0, 2));
  const posState = inv.placeOfSupply.trim() ? stateCodeOf(inv.placeOfSupply) : buy?.stateCode;
  if (inv.placeOfSupply.trim() && !posState) add('warning', 'placeOfSupply', 'Could not match the place of supply to a state.');
  const intra = supState && posState ? supState === posState : undefined;

  if (!inv.lines.length) add('error', 'lines', 'No line items.');
  const sum = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
  let sumsComplete = inv.lines.length > 0;

  inv.lines.forEach((l, i) => {
    const p = `lines.${i}`;
    const q = parseAmount(l.quantity);
    const rate = parseAmount(l.rate);
    const taxable = parseAmount(l.taxable);
    const gstRate = parseAmount(l.gstRate);
    const cgst = parseAmount(l.cgst) ?? 0;
    const sgst = parseAmount(l.sgst) ?? 0;
    const igst = parseAmount(l.igst) ?? 0;

    if (!l.description.trim()) add('warning', `${p}.description`, 'Line description is missing.');
    if (!l.hsn.trim()) add('warning', `${p}.hsn`, 'HSN/SAC code is missing.');
    else if (!/^(\d{4}|\d{6}|\d{8})$/.test(l.hsn.trim())) add('error', `${p}.hsn`, 'HSN/SAC must be 4, 6 or 8 digits.');

    if (taxable === null) {
      add('error', `${p}.taxable`, 'Taxable value is missing or not a number.');
      sumsComplete = false;
    } else {
      sum.taxable += taxable;
      if (q !== null && rate !== null && !near(q * rate, taxable)) {
        add('error', `${p}.taxable`, `Quantity × rate is ${round2(q * rate).toFixed(2)}, but taxable value is ${taxable.toFixed(2)}.`);
      }
    }
    sum.cgst += cgst;
    sum.sgst += sgst;
    sum.igst += igst;

    if (gstRate === null) add('error', `${p}.gstRate`, 'GST rate is missing or not a number.');
    else {
      if (!GST_SLABS.includes(gstRate)) add('warning', `${p}.gstRate`, `${gstRate}% is not a standard GST rate.`);
      if (taxable !== null && !near((taxable * gstRate) / 100, cgst + sgst + igst)) {
        add('error', `${p}.gstRate`, `${gstRate}% of ${taxable.toFixed(2)} is ${round2((taxable * gstRate) / 100).toFixed(2)}, but the line tax adds up to ${round2(cgst + sgst + igst).toFixed(2)}.`);
      }
    }

    if (intra === true && igst > 0) add('error', `${p}.igst`, 'Supplier and place of supply are in the same state, so tax should be CGST + SGST, not IGST.');
    if (intra === false && (cgst > 0 || sgst > 0)) add('error', `${p}.${cgst > 0 ? 'cgst' : 'sgst'}`, 'Supplier and place of supply are in different states, so tax should be IGST, not CGST + SGST.');
    if (cgst > 0 && sgst > 0 && !near(cgst, sgst, 0.011)) add('warning', `${p}.sgst`, 'CGST and SGST are normally equal.');

    const total = parseAmount(l.total);
    if (total !== null && taxable !== null && !near(total, taxable + cgst + sgst + igst)) {
      add('warning', `${p}.total`, `Line total ${total.toFixed(2)} differs from taxable + tax (${round2(taxable + cgst + sgst + igst).toFixed(2)}).`);
    }
  });

  // Document totals
  const t = inv.totals;
  const tTaxable = parseAmount(t.taxable);
  const tCgst = parseAmount(t.cgst) ?? 0;
  const tSgst = parseAmount(t.sgst) ?? 0;
  const tIgst = parseAmount(t.igst) ?? 0;
  const roundOff = parseAmount(t.roundOff) ?? 0;
  const grand = parseAmount(t.grandTotal);

  if (grand === null) add('error', 'totals.grandTotal', 'Grand total is missing or not a number.');
  if (tTaxable !== null && sumsComplete && !near(sum.taxable, tTaxable)) {
    add('error', 'totals.taxable', `Line taxable values add up to ${round2(sum.taxable).toFixed(2)}, but the document total is ${tTaxable.toFixed(2)}.`);
  }
  for (const [k, lineSum, doc] of [['cgst', sum.cgst, tCgst], ['sgst', sum.sgst, tSgst], ['igst', sum.igst, tIgst]] as const) {
    if (!near(lineSum, doc)) add('error', `totals.${k}`, `Line ${k.toUpperCase()} adds up to ${round2(lineSum).toFixed(2)}, but the document total is ${doc.toFixed(2)}.`);
  }
  if (grand !== null && tTaxable !== null && !near(tTaxable + tCgst + tSgst + tIgst + roundOff, grand, 0.51)) {
    add('error', 'totals.grandTotal', `Taxable + tax + round-off is ${round2(tTaxable + tCgst + tSgst + tIgst + roundOff).toFixed(2)}, but the grand total is ${grand.toFixed(2)}.`);
  }
  if (Math.abs(roundOff) > 1) add('warning', 'totals.roundOff', 'Round-off is larger than ₹1.');

  return issues;
}

export const errorCount = (issues: Issue[]) => issues.filter((i) => i.severity === 'error').length;
