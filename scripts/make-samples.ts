import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { round2 } from '../src/lib/amounts';
import { gstinCheckChar } from '../src/lib/gstin';
import type { Extraction } from '../src/lib/schema';

// Builds the three FICTIONAL sample invoices, the exact "truth" for each, and the "recorded" model
// outputs used when no API key is set. Run: npm run samples. All names, numbers and GSTINs are invented;
// the GSTINs are structurally valid (correct checksum) and could coincide with a real number by chance.

const gstin = (state: string, pan: string, entity = '1') => {
  const first14 = `${state}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
};

interface L { d: string; hsn: string; qty: number; unit: string; rate: number; gst: number }
interface Doc {
  id: string; title: string; blurb: string;
  supplier: { name: string; addr: string; gstin: string };
  buyer: { name: string; addr: string; gstin: string };
  no: string; date: string; pos: string; lines: L[];
  taxMode: 'intra' | 'inter';
}

function build(doc: Doc): Extraction {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0;
  const lines = doc.lines.map((l) => {
    const t = round2(l.qty * l.rate);
    const tax = round2((t * l.gst) / 100);
    const c = doc.taxMode === 'intra' ? round2(tax / 2) : null;
    const g = doc.taxMode === 'inter' ? tax : null;
    taxable += t; cgst += c ?? 0; sgst += c ?? 0; igst += g ?? 0;
    return {
      description: l.d, hsn: l.hsn, quantity: l.qty, unit: l.unit, rate: l.rate, taxableValue: t, gstRate: l.gst,
      cgst: c, sgst: c, igst: g, lineTotal: round2(t + (c ?? 0) * 2 + (g ?? 0)),
    };
  });
  const sum = round2(taxable + cgst + sgst + igst);
  const grand = Math.round(sum);
  return {
    isInvoice: true,
    supplierName: doc.supplier.name, supplierGstin: doc.supplier.gstin, buyerName: doc.buyer.name, buyerGstin: doc.buyer.gstin,
    invoiceNumber: doc.no, invoiceDate: doc.date, placeOfSupply: doc.pos, lines,
    totals: {
      taxableValue: round2(taxable), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst),
      roundOff: round2(grand - sum), grandTotal: grand,
    },
    uncertainFields: [],
  };
}

const f = (n: number | null) => (n === null ? '-' : n.toFixed(2));

function render(doc: Doc, e: Extraction): string {
  const w = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s.padEnd(n));
  const out: string[] = [
    'TAX INVOICE',
    '',
    doc.supplier.name,
    doc.supplier.addr,
    `GSTIN: ${doc.supplier.gstin}`,
    '',
    `Invoice No: ${doc.no}        Date: ${doc.date}`,
    `Place of Supply: ${doc.pos}`,
    '',
    'Bill To:',
    doc.buyer.name,
    doc.buyer.addr,
    `GSTIN: ${doc.buyer.gstin}`,
    '',
    `${w('#', 3)}${w('Description', 30)}${w('HSN', 7)}${w('Qty', 5)}${w('Unit', 6)}${w('Rate', 10)}${w('Taxable', 11)}${w('GST%', 6)}${doc.taxMode === 'intra' ? w('CGST', 9) + w('SGST', 9) : w('IGST', 9)}`,
  ];
  e.lines.forEach((l, i) => {
    out.push(
      `${w(String(i + 1), 3)}${w(l.description ?? '', 30)}${w(l.hsn ?? '', 7)}${w(String(l.quantity), 5)}${w(l.unit ?? '', 6)}${w(f(l.rate), 10)}${w(f(l.taxableValue), 11)}${w(String(l.gstRate), 6)}${
        doc.taxMode === 'intra' ? w(f(l.cgst), 9) + w(f(l.sgst), 9) : w(f(l.igst), 9)
      }`,
    );
  });
  const t = e.totals;
  out.push('', `Total Taxable Value: ${f(t.taxableValue)}`);
  if (doc.taxMode === 'intra') out.push(`CGST: ${f(t.cgst)}`, `SGST: ${f(t.sgst)}`);
  else out.push(`IGST: ${f(t.igst)}`);
  out.push(`Round off: ${f(t.roundOff)}`, `GRAND TOTAL: Rs. ${f(t.grandTotal)}`, '', 'Declaration: We declare that this invoice shows the actual price of the goods described.', 'This is a computer generated sample invoice for a FICTIONAL business.');
  return out.join('\n');
}

const docs: Doc[] = [
  {
    id: 'clean-intra-state', title: 'Sample 1: clean, same-state sale (CGST + SGST)',
    blurb: 'A tidy invoice. Everything should check out.',
    supplier: { name: 'Sunrise Stationers Pvt Ltd', addr: '12 Market Road, Mumbai, Maharashtra 400001', gstin: gstin('27', 'AABCS4412Q') },
    buyer: { name: 'Kavya Traders', addr: '48 Station Lane, Pune, Maharashtra 411001', gstin: gstin('27', 'AAFFK5678L') },
    no: 'SS/2026/0412', date: '14/03/2026', pos: 'Maharashtra (27)', taxMode: 'intra',
    lines: [
      { d: 'A4 copier paper 75 GSM', hsn: '4802', qty: 40, unit: 'REAM', rate: 285, gst: 12 },
      { d: 'Ball pen box (50 pcs)', hsn: '9608', qty: 12, unit: 'BOX', rate: 180, gst: 18 },
      { d: 'Heavy duty stapler', hsn: '8472', qty: 6, unit: 'NOS', rate: 449.5, gst: 18 },
    ],
  },
  {
    id: 'clean-inter-state', title: 'Sample 2: clean, other-state sale (IGST)',
    blurb: 'Different states, so IGST applies. Everything should check out.',
    supplier: { name: 'Deccan Hardware LLP', addr: '7 Industrial Layout, Bengaluru, Karnataka 560010', gstin: gstin('29', 'AAFFD9021H') },
    buyer: { name: 'Orchid Interiors', addr: '21 Lodhi Estate, New Delhi 110003', gstin: gstin('07', 'AAEPO3318M') },
    no: 'DH/26-27/0087', date: '02/05/2026', pos: 'Delhi (07)', taxMode: 'inter',
    lines: [
      { d: 'Stainless steel hinges 4 inch', hsn: '8302', qty: 150, unit: 'NOS', rate: 62.75, gst: 18 },
      { d: 'Cabinet handle set', hsn: '8302', qty: 80, unit: 'SET', rate: 118, gst: 18 },
    ],
  },
  {
    id: 'needs-review', title: 'Sample 3: needs review (misreads and a wrong tax type)',
    blurb: 'The printed invoice charges CGST + SGST on a sale to another state, and the recorded extraction misreads two values. The validators should flag them.',
    supplier: { name: 'Greenfield Agro Supplies', addr: '3 APMC Yard, Nashik, Maharashtra 422001', gstin: gstin('27', 'AAHFG7745C') },
    buyer: { name: 'Patel Farm Inputs', addr: '90 Ring Road, Surat, Gujarat 395002', gstin: gstin('24', 'AAGFP1156D') },
    no: 'GA/0231', date: '21/06/2026', pos: 'Gujarat (24)', taxMode: 'intra',
    lines: [
      { d: 'NPK fertiliser 50 kg bag', hsn: '3105', qty: 25, unit: 'BAG', rate: 1250, gst: 5 },
      { d: 'Drip irrigation kit', hsn: '8424', qty: 8, unit: 'KIT', rate: 1250, gst: 12 },
    ],
  },
];

mkdirSync(join('data', 'samples'), { recursive: true });
mkdirSync('src/generated', { recursive: true });

const out = docs.map((doc) => {
  const truth = build(doc);
  const text = render(doc, truth);
  writeFileSync(join('data', 'samples', `${doc.id}.txt`), text + '\n');
  writeFileSync(join('data', 'samples', `${doc.id}.truth.json`), JSON.stringify(truth, null, 2) + '\n');

  // What a model might return. Samples 1 and 2 are read perfectly; sample 3 has two plausible misreads.
  const recorded: Extraction = JSON.parse(JSON.stringify(truth));
  if (doc.id === 'needs-review') {
    const g = recorded.supplierGstin!;
    recorded.supplierGstin = g.slice(0, 14) + (g[14] === '5' ? '6' : '5'); // last character misread
    recorded.lines[1].rate = 1520; // 1250 read as 1520
  }
  return { id: doc.id, title: doc.title, blurb: doc.blurb, text, recorded };
});

writeFileSync(
  'src/generated/samples.ts',
  `// AUTO-GENERATED by \`npm run samples\`. Fictional invoices; "recorded" is hand-made output standing in for a model.\nimport type { Extraction } from '../lib/schema';\n\nexport interface Sample { id: string; title: string; blurb: string; text: string; recorded: Extraction }\n\nexport const SAMPLES: Sample[] = ${JSON.stringify(out, null, 2)};\n`,
);
console.log('Wrote', out.map((o) => o.id).join(', '));
