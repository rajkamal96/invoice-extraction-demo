import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SAMPLES } from '../src/generated/samples';
import { parseAmount } from '../src/lib/amounts';
import { generateJson } from '../src/lib/llm';
import { SYSTEM_PROMPT } from '../src/lib/prompts';
import { EXTRACTION_JSON_SCHEMA, ExtractionSchema, toForm, type Extraction } from '../src/lib/schema';
import type { InvoiceForm } from '../src/lib/invoice';
import { validateInvoice } from '../src/lib/validate';

// Offline (default, free, no model):
//   1. Do the code checks pass on the correct data of the clean samples?
//   2. If ONE digit of a correct field is misread, do the code checks flag it?  (synthetic errors)
//   3. Are the recorded "needs review" misreads flagged?
// With --live (needs GEMINI_API_KEY, uses free-tier quota): sends the 3 sample texts to the real
// model and compares every field with the known truth.

const TODAY = new Date('2026-10-31T00:00:00Z');
const truthOf = (id: string) => JSON.parse(readFileSync(join('data', 'samples', `${id}.truth.json`), 'utf8')) as Extraction;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const errs = (inv: InvoiceForm) => validateInvoice(inv, { today: TODAY }).filter((i) => i.severity === 'error').length;
const anyFlag = (inv: InvoiceForm) => validateInvoice(inv, { today: TODAY }).length;

type Cat = 'GSTIN' | 'amount / rate / qty' | 'tax amount' | 'HSN code' | 'date' | 'text (names, description, number)';
const catOf = (path: string): Cat => {
  if (/gstin/i.test(path)) return 'GSTIN';
  if (/hsn/.test(path)) return 'HSN code';
  if (/invoiceDate/.test(path)) return 'date';
  if (/(cgst|sgst|igst)$/.test(path)) return 'tax amount';
  if (/(quantity|rate|taxable|gstRate|total|grandTotal|roundOff)$/i.test(path)) return 'amount / rate / qty';
  return 'text (names, description, number)';
};

/** Every (path, getter/setter) of the form that has a value. */
function fields(inv: InvoiceForm): { path: string; get: () => string; set: (v: string) => void }[] {
  const out: { path: string; get: () => string; set: (v: string) => void }[] = [];
  for (const k of ['supplierName', 'supplierGstin', 'buyerName', 'buyerGstin', 'invoiceNumber', 'invoiceDate', 'placeOfSupply'] as const) {
    out.push({ path: k, get: () => inv[k], set: (v) => (inv[k] = v) });
  }
  inv.lines.forEach((l, i) => (Object.keys(l) as (keyof typeof l)[]).forEach((k) => out.push({ path: `lines.${i}.${k}`, get: () => l[k], set: (v) => (l[k] = v) })));
  (Object.keys(inv.totals) as (keyof typeof inv.totals)[]).forEach((k) => out.push({ path: `totals.${k}`, get: () => inv.totals[k], set: (v) => (inv.totals[k] = v) }));
  return out;
}

const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '0/0');

function offline() {
  console.log('1. Code checks on the correct data of the clean samples');
  for (const id of ['clean-intra-state', 'clean-inter-state']) {
    console.log(`   ${id}: ${errs(toForm(truthOf(id)))} errors (expected 0)`);
  }

  console.log('\n2. Single-digit misreads injected into correct fields (synthetic; same errors a model could make)');
  const stats = new Map<Cat, { total: number; caught: number; warned: number }>();
  const missed = new Map<string, number>();
  for (const id of ['clean-intra-state', 'clean-inter-state']) {
    const base = toForm(truthOf(id));
    const n = fields(base).length;
    for (let fi = 0; fi < n; fi++) {
      const inv = clone(base);
      const f = fields(inv)[fi];
      const value = f.get();
      // Change each digit position in turn (d -> d+3 mod 10); non-digit fields are skipped.
      for (let pos = 0; pos < value.length; pos++) {
        if (!/\d/.test(value[pos])) continue;
        const mutated = clone(inv);
        const mf = fields(mutated)[fi];
        mf.set(value.slice(0, pos) + String((Number(value[pos]) + 3) % 10) + value.slice(pos + 1));
        if (mf.get() === value) continue;
        const cat = catOf(f.path);
        const s = stats.get(cat) ?? { total: 0, caught: 0, warned: 0 };
        s.total++;
        if (anyFlag(mutated) > 0) s.warned++;
        if (errs(mutated) > 0) s.caught++;
        else missed.set(f.path.replace(/\.\d+\./, '.N.'), (missed.get(f.path.replace(/\.\d+\./, '.N.')) ?? 0) + 1);
        stats.set(cat, s);
      }
    }
  }
  let T = 0, C = 0, W = 0;
  console.log(`   ${''.padEnd(36)} error / error-or-warning`);
  for (const [cat, s] of stats) {
    console.log(`   ${cat.padEnd(36)} ${pct(s.caught, s.total)}  /  ${pct(s.warned, s.total)}`);
    T += s.total; C += s.caught; W += s.warned;
  }
  console.log(`   ${'ALL'.padEnd(36)} ${pct(C, T)}  /  ${pct(W, T)}`);
  console.log('   Limits by design: a changed HSN or invoice number still looks valid, a date can change into another valid date, changes of a few paise');
  console.log('   stay inside the ₹1 rounding tolerance, and names and descriptions have no cross-check, so those need a human reading the document.');
  if (missed.size) console.log(`   Fields where some misreads produced no error: ${[...missed].map(([k, v]) => `${k} (${v})`).join(', ')}`);

  console.log('\n3. Recorded misreads in the "needs review" sample');
  const rec = SAMPLES.find((s) => s.id === 'needs-review')!;
  const flagged = validateInvoice(toForm(rec.recorded), { today: TODAY }).filter((i) => i.severity === 'error');
  console.log(`   ${flagged.length} errors flagged: ${[...new Set(flagged.map((f) => f.field))].join(', ')}`);
  console.log('   (the printed invoice itself charges CGST+SGST on an other-state sale, which is also flagged)');
}

async function live() {
  if (!process.env.GEMINI_API_KEY) throw new Error('--live needs GEMINI_API_KEY in the environment');
  console.log('\n4. LIVE: real model on the 3 sample texts, compared with the known truth');
  let total = 0, right = 0;
  for (const s of SAMPLES) {
    const truth = toForm(truthOf(s.id));
    const raw = await generateJson({ system: SYSTEM_PROMPT, text: `<document>\n${s.text}\n</document>`, schema: EXTRACTION_JSON_SCHEMA });
    const got = toForm(ExtractionSchema.parse(raw));
    const wrong: string[] = [];
    const tf = fields(truth), gf = fields(got);
    // Lines are compared by index; a different number of lines counts as every missing field being wrong.
    for (const f of tf) {
      total++;
      const g = gf.find((x) => x.path === f.path)?.get() ?? '';
      const same = f.get() === g || (parseAmount(f.get()) !== null && parseAmount(f.get()) === parseAmount(g));
      if (same) right++;
      else wrong.push(`${f.path}: expected "${f.get()}", got "${g}"`);
    }
    const flaggedPaths = new Set(validateInvoice(got, { today: TODAY, uncertain: (raw as Extraction).uncertainFields }).map((i) => i.field));
    console.log(`   ${s.id}: ${pct(tf.length - wrong.length, tf.length)} fields exact`);
    for (const w of wrong) console.log(`     - ${w}${flaggedPaths.has(w.split(':')[0]) ? '   [flagged]' : '   [NOT flagged]'}`);
    await new Promise((r) => setTimeout(r, 4500)); // stay under free-tier per-minute limits
  }
  console.log(`   ALL: ${pct(right, total)} fields exact. Three tiny fictional text samples: this is a smoke test, not a benchmark.`);
}

async function main() {
  const { values } = parseArgs({ options: { live: { type: 'boolean', default: false } } });
  console.log('Samples were written by the demo author (an AI assistant working with the developer), with clean layouts; scores favour them.\n');
  offline();
  if (values.live) await live();
  else console.log('\n4. Live model check: NOT RUN (use --live with GEMINI_API_KEY). Nothing above measures a real model\'s reading accuracy.');
}

main().catch((e) => {
  console.error('Eval failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
