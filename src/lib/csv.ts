import { parseAmount } from './amounts';
import type { InvoiceForm } from './invoice';

/**
 * A spreadsheet treats a cell starting with = + - @ (or tab/CR) as a formula. Invoice text is
 * untrusted, so such cells are prefixed with an apostrophe. Numbers are exempt: a negative amount
 * like -5.00 is legitimate and is written from a parsed number, not from raw text.
 */
export function csvCell(value: string | number): string {
  let v = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const HEADER = [
  'invoice_number', 'invoice_date', 'supplier_name', 'supplier_gstin', 'buyer_name', 'buyer_gstin', 'place_of_supply',
  'line_no', 'description', 'hsn_sac', 'quantity', 'unit', 'rate', 'taxable_value', 'gst_rate', 'cgst', 'sgst', 'igst', 'line_total',
  'invoice_taxable_total', 'invoice_cgst', 'invoice_sgst', 'invoice_igst', 'round_off', 'invoice_grand_total',
];

const num = (s: string): string | number => {
  const n = parseAmount(s);
  return n === null ? s : n;
};

/** One row per line item, with the invoice header repeated, ready for Excel or an import script. */
export function toCsv(invoices: InvoiceForm[]): string {
  const rows = [HEADER.join(',')];
  for (const inv of invoices) {
    const head = [inv.invoiceNumber, inv.invoiceDate, inv.supplierName, inv.supplierGstin, inv.buyerName, inv.buyerGstin, inv.placeOfSupply];
    const tail = [inv.totals.taxable, inv.totals.cgst, inv.totals.sgst, inv.totals.igst, inv.totals.roundOff, inv.totals.grandTotal].map(num);
    inv.lines.forEach((l, i) => {
      const cells = [
        ...head, i + 1, l.description, l.hsn, num(l.quantity), l.unit, num(l.rate), num(l.taxable), num(l.gstRate),
        num(l.cgst), num(l.sgst), num(l.igst), num(l.total), ...tail,
      ];
      rows.push(cells.map(csvCell).join(','));
    });
  }
  return rows.join('\r\n') + '\r\n';
}
