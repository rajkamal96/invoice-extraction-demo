import { createServer } from 'node:http';
import { SAMPLES } from '../src/generated/samples';

// A FAKE Gemini endpoint for local testing without an API key or quota:
//   npx tsx scripts/fake-gemini.ts            (listens on :4010)
//   GEMINI_API_BASE=http://127.0.0.1:4010 GEMINI_API_KEY=fake npm start
// It reads nothing. For text it returns the recorded output of the sample whose invoice number appears in
// the text (or "not an invoice" if none does); for any attached file it returns sample 2. It proves the
// plumbing (request shape, schema, validation, UI), NOT reading accuracy. Never use it to judge the model.

const port = Number(process.env.PORT ?? 4010);

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const data = JSON.parse(body) as { contents: { parts: { text?: string; inline_data?: unknown }[] }[] };
      const parts = data.contents[0].parts;
      const hasFile = parts.some((p) => p.inline_data);
      const text = parts.map((p) => p.text ?? '').join('\n');
      const hit = hasFile ? SAMPLES[1] : SAMPLES.find((s) => text.includes(s.text.split('\n').find((l) => l.startsWith('Invoice No:'))!.split(/\s{2,}/)[0]));
      const out = hit ? hit.recorded : { ...SAMPLES[0].recorded, isInvoice: false, lines: [], supplierName: null };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] }));
    } catch {
      res.writeHead(400);
      res.end('{"error":{"message":"bad request"}}');
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`fake gemini on http://127.0.0.1:${port}`));
