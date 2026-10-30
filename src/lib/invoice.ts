// The invoice as shown in the review form. Every value is a string because that is what a person
// edits; validation parses the strings, so a typo is validated exactly like a model misread.

export interface LineForm {
  description: string;
  hsn: string;
  quantity: string;
  unit: string;
  rate: string;
  taxable: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

export interface TotalsForm {
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  grandTotal: string;
}

export interface InvoiceForm {
  supplierName: string;
  supplierGstin: string;
  buyerName: string;
  buyerGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  placeOfSupply: string;
  lines: LineForm[];
  totals: TotalsForm;
}

export const emptyLine = (): LineForm => ({
  description: '', hsn: '', quantity: '', unit: '', rate: '', taxable: '', gstRate: '', cgst: '', sgst: '', igst: '', total: '',
});

export const emptyInvoice = (): InvoiceForm => ({
  supplierName: '', supplierGstin: '', buyerName: '', buyerGstin: '', invoiceNumber: '', invoiceDate: '', placeOfSupply: '',
  lines: [emptyLine()],
  totals: { taxable: '', cgst: '', sgst: '', igst: '', roundOff: '', grandTotal: '' },
});

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** Field path, e.g. "supplierGstin", "lines.0.taxable", "totals.grandTotal". Empty = whole document. */
  field: string;
  message: string;
}
