import { hasApiKey, generateJson as defaultGenerate, LlmError, type GenerateJson } from './llm';
import { SYSTEM_PROMPT } from './prompts';
import { defaultLimiter, type Limiter } from './rateLimit';
import { EXTRACTION_JSON_SCHEMA, ExtractionSchema, ExtractRequestSchema, toForm, type Extraction } from './schema';
import { validateInvoice } from './validate';
import type { Sample } from '../generated/samples';

export interface Deps {
  samples: Sample[];
  generate: GenerateJson;
  limiter: Limiter;
  /** True when a model key is configured. Without one, only the recorded samples work. */
  isLive: () => boolean;
  isEnabled: () => boolean;
}

const MAX_BODY_BYTES = 4_500_000;

const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || 'unknown';

export function createHandlers(overrides: Partial<Deps> & { samples: Sample[] }) {
  const deps: Deps = {
    generate: overrides.generate ?? defaultGenerate,
    limiter: overrides.limiter ?? defaultLimiter(),
    isLive: overrides.isLive ?? hasApiKey,
    isEnabled: overrides.isEnabled ?? (() => process.env.EXTRACT_ENABLED !== 'false'),
    samples: overrides.samples,
  };

  const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
  const fail = (status: number, error: string, message: string, headers?: HeadersInit) =>
    json({ ok: false, error, message }, status, headers);

  function status() {
    return json({
      ok: true,
      enabled: deps.isEnabled(),
      live: deps.isLive(),
      samples: deps.samples.map((s) => ({ id: s.id, title: s.title, blurb: s.blurb, text: s.text })),
    });
  }

  async function extract(req: Request): Promise<Response> {
    if (!deps.isEnabled()) return fail(503, 'disabled', 'Extraction is switched off right now.');

    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_BODY_BYTES) return fail(413, 'too_large', 'That file is too large. The demo accepts files up to about 3 MB.');
    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return fail(400, 'bad_request', 'Invalid request.');
    }
    const parsed = ExtractRequestSchema.safeParse(body);
    if (!parsed.success) return fail(400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid request.');
    const { sampleId, text, file } = parsed.data;

    // Recorded samples cost nothing and call no model, so they are not rate limited.
    let sample: Sample | undefined;
    if (sampleId) {
      sample = deps.samples.find((s) => s.id === sampleId);
      if (!sample) return fail(404, 'unknown_sample', 'Unknown sample.');
    }
    const live = deps.isLive();
    if (sample && !live) return respond(sample.recorded, 'recorded', 'text');
    if (!live) {
      return fail(503, 'not_live', 'Uploading your own document needs a live model, which is not set up on this server. Try one of the samples.');
    }

    const limit = deps.limiter.check(clientIp(req));
    if (!limit.ok) {
      const msg = limit.reason === 'daily' ? 'The demo has reached its free daily limit. Please try again tomorrow.' : 'You are sending documents quickly. Please wait a few minutes and try again.';
      return fail(429, 'rate_limited', msg, { 'Retry-After': String(limit.retryAfterSec) });
    }

    try {
      const raw = await deps.generate({
        system: SYSTEM_PROMPT,
        text: file ? 'Extract the invoice in the attached document.' : `<document>\n${sample?.text ?? text}\n</document>`,
        file: file ? { mimeType: file.mimeType, dataBase64: file.dataBase64 } : undefined,
        schema: EXTRACTION_JSON_SCHEMA,
        maxOutputTokens: 6000,
      });
      const extraction = ExtractionSchema.parse(raw);
      if (!extraction.isInvoice) return fail(422, 'not_an_invoice', 'That does not look like a GST tax invoice.');
      return respond(extraction, 'model', file ? 'file' : 'text');
    } catch (err) {
      if (err instanceof LlmError) {
        if (err.code === 'not_configured') return fail(503, 'not_live', 'The model is not set up on this server.');
        if (err.code === 'rate_limited') return fail(429, 'rate_limited', 'The free model quota is used up for now. Please try again later.');
        if (err.code === 'bad_output') return fail(502, 'bad_output', 'The model returned something unusable. Please try again.');
        return fail(503, 'unavailable', 'The model is temporarily unavailable. Please try again shortly.');
      }
      if (err instanceof Error && err.name === 'ZodError') return fail(502, 'bad_output', 'The model returned something unusable. Please try again.');
      console.error('Extract error:', err instanceof Error ? err.message : err);
      return fail(500, 'server_error', 'Something went wrong. Please try again.');
    }
  }

  function respond(extraction: Extraction, source: 'model' | 'recorded', kind: 'text' | 'file') {
    const invoice = toForm(extraction);
    const uncertain = extraction.uncertainFields;
    return json({ ok: true, source, kind, invoice, uncertain, issues: validateInvoice(invoice, { uncertain }) });
  }

  return { extract, status };
}
