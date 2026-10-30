import { z } from 'zod';
import type { InvoiceForm, LineForm } from './invoice';

const amount = z.number().min(-1e10).max(1e10).nullable();
const text = (n: number) => z.string().max(n).nullable();

/** What the model returns. Numbers are JSON numbers or null; anything it cannot read is null. */
export const ExtractionSchema = z.object({
  isInvoice: z.boolean(),
  supplierName: text(200),
  supplierGstin: text(30),
  buyerName: text(200),
  buyerGstin: text(30),
  invoiceNumber: text(60),
  invoiceDate: text(40),
  placeOfSupply: text(80),
  lines: z
    .array(
      z.object({
        description: text(300),
        hsn: text(20),
        quantity: amount,
        unit: text(20),
        rate: amount,
        taxableValue: amount,
        gstRate: amount,
        cgst: amount,
        sgst: amount,
        igst: amount,
        lineTotal: amount,
      }),
    )
    .max(60),
  totals: z.object({
    taxableValue: amount,
    cgst: amount,
    sgst: amount,
    igst: amount,
    roundOff: amount,
    grandTotal: amount,
  }),
  /** Field paths the model could not read clearly, e.g. "supplierGstin" or "lines.1.rate". */
  uncertainFields: z.array(z.string().max(60)).max(40),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const S = (nullable = true) => ({ type: 'STRING', nullable });
const N = { type: 'NUMBER', nullable: true };

/** The same shape for Gemini's responseSchema. */
export const EXTRACTION_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isInvoice: { type: 'BOOLEAN' },
    supplierName: S(), supplierGstin: S(), buyerName: S(), buyerGstin: S(),
    invoiceNumber: S(), invoiceDate: S(), placeOfSupply: S(),
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: S(), hsn: S(), quantity: N, unit: S(), rate: N, taxableValue: N, gstRate: N,
          cgst: N, sgst: N, igst: N, lineTotal: N,
        },
        required: ['description', 'hsn', 'quantity', 'unit', 'rate', 'taxableValue', 'gstRate', 'cgst', 'sgst', 'igst', 'lineTotal'],
      },
    },
    totals: {
      type: 'OBJECT',
      properties: { taxableValue: N, cgst: N, sgst: N, igst: N, roundOff: N, grandTotal: N },
      required: ['taxableValue', 'cgst', 'sgst', 'igst', 'roundOff', 'grandTotal'],
    },
    uncertainFields: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['isInvoice', 'supplierName', 'supplierGstin', 'buyerName', 'buyerGstin', 'invoiceNumber', 'invoiceDate', 'placeOfSupply', 'lines', 'totals', 'uncertainFields'],
} as const;

const s = (v: string | number | null) => (v === null || v === undefined ? '' : String(v));

/** Extraction -> editable form. GSTINs are upper-cased and stripped of spaces; nothing else is "fixed". */
export function toForm(e: Extraction): InvoiceForm {
  const lines: LineForm[] = e.lines.map((l) => ({
    description: s(l.description), hsn: s(l.hsn), quantity: s(l.quantity), unit: s(l.unit), rate: s(l.rate),
    taxable: s(l.taxableValue), gstRate: s(l.gstRate), cgst: s(l.cgst), sgst: s(l.sgst), igst: s(l.igst), total: s(l.lineTotal),
  }));
  return {
    supplierName: s(e.supplierName),
    supplierGstin: s(e.supplierGstin).replace(/\s+/g, '').toUpperCase(),
    buyerName: s(e.buyerName),
    buyerGstin: s(e.buyerGstin).replace(/\s+/g, '').toUpperCase(),
    invoiceNumber: s(e.invoiceNumber),
    invoiceDate: s(e.invoiceDate),
    placeOfSupply: s(e.placeOfSupply),
    lines,
    totals: {
      taxable: s(e.totals.taxableValue), cgst: s(e.totals.cgst), sgst: s(e.totals.sgst),
      igst: s(e.totals.igst), roundOff: s(e.totals.roundOff), grandTotal: s(e.totals.grandTotal),
    },
  };
}

/** Request body for POST /api/extract. Exactly one of text / file. */
export const ExtractRequestSchema = z
  .object({
    sampleId: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    text: z.string().max(40_000).optional(),
    file: z
      .object({
        name: z.string().max(120),
        mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
        // ~3 MB of file after base64 (keeps the whole request under serverless body limits)
        dataBase64: z.string().max(4_200_000).regex(/^[A-Za-z0-9+/=\s]+$/),
      })
      .optional(),
  })
  .refine((v) => [v.sampleId, v.text, v.file].filter((x) => x !== undefined).length === 1, 'Send exactly one of sampleId, text or file.');
