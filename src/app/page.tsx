'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toCsv } from '../lib/csv';
import type { InvoiceForm, Issue } from '../lib/invoice';
import { errorCount, validateInvoice } from '../lib/validate';
import { ReviewForm } from './ReviewForm';

interface SampleInfo { id: string; title: string; blurb: string; text: string }
interface Doc {
  id: string;
  name: string;
  source: 'model' | 'recorded';
  kind: 'text' | 'file';
  preview: { type: 'text'; text: string } | { type: 'image' | 'pdf'; url: string };
  invoice: InvoiceForm;
  uncertain: string[];
  approved: boolean;
}

const MAX_BYTES = 3 * 1024 * 1024;

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

export default function Page() {
  const [status, setStatus] = useState<{ enabled: boolean; live: boolean; samples: SampleInfo[] } | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/extract')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError('Could not reach the server.'));
  }, []);

  const run = useCallback(async (name: string, body: unknown, preview: Doc['preview']) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || 'Extraction failed.');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setDocs((d) => [...d, { id, name, source: data.source, kind: data.kind, preview, invoice: data.invoice, uncertain: data.uncertain, approved: false }]);
      setSelected(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (file.size > MAX_BYTES) return setError('That file is over 3 MB. Please use a smaller file.');
    if (file.type === 'text/plain') {
      const text = await file.text();
      return run(file.name, { text }, { type: 'text', text });
    }
    const types = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!types.includes(file.type)) return setError('Please choose a PDF, PNG, JPG, WebP or plain text file.');
    const url = URL.createObjectURL(file);
    await run(file.name, { file: { name: file.name, mimeType: file.type, dataBase64: await toBase64(file) } }, { type: file.type === 'application/pdf' ? 'pdf' : 'image', url });
  };

  const doc = docs.find((d) => d.id === selected) ?? null;
  const issues: Issue[] = useMemo(() => (doc ? validateInvoice(doc.invoice, { uncertain: doc.uncertain }) : []), [doc]);
  const update = (patch: Partial<Doc>) => setDocs((all) => all.map((d) => (d.id === selected ? { ...d, ...patch } : d)));
  const approved = docs.filter((d) => d.approved);

  return (
    <div className="wrap">
      <h1>
        GST invoice extraction with human review
        {status && <span className={`badge ${status.live ? 'live' : 'rec'}`}>{status.live ? 'live model' : 'recorded samples only'}</span>}
      </h1>
      <p className="muted">A model reads the invoice, plain code checks it (GSTIN checksum, tax maths, same-state vs other-state tax), and a person fixes what is flagged before export.</p>
      <div className="note">
        <strong>Portfolio demo.</strong> Every invoice here is fictional. {status && !status.live && <>No model key is set on this server, so the samples show <em>recorded</em> output written by hand to stand in for a model; uploads are switched off. </>}
        Don&rsquo;t upload real invoices to this demo: files are sent to a free-tier model API and nothing here is a compliance tool. See the README.
      </div>

      <section className="card" aria-labelledby="in">
        <h2 id="in">1. Choose a document</h2>
        <div className="samples">
          {status?.samples.map((s) => (
            <button key={s.id} className="sample" disabled={busy || !status.enabled} onClick={() => run(s.title, { sampleId: s.id }, { type: 'text', text: s.text })}>
              <b>{s.title}</b>
              <span className="muted">{s.blurb}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label htmlFor="file">Or upload your own (PDF, PNG, JPG, WebP, TXT; up to 3 MB):</label>
          <input id="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,text/plain" disabled={busy || !status?.live} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          {status && !status.live && <span className="muted">Needs a live model (not set up here).</span>}
        </div>
        <p role="status" aria-live="polite" className="muted" style={{ margin: '8px 0 0' }}>{busy ? 'Reading the document…' : ''}</p>
        {error && <p role="alert" className="msg error" style={{ fontSize: 14 }}>{error}</p>}
      </section>

      {doc && (
        <section className="card" aria-labelledby="rv">
          <h2 id="rv">2. Review</h2>
          {docs.length > 1 && (
            <div className="tabs" role="group" aria-label="Documents" style={{ marginBottom: 10 }}>
              {docs.map((d, i) => (
                <button key={d.id} aria-pressed={d.id === selected} onClick={() => setSelected(d.id)}>{i + 1}. {d.name.slice(0, 28)}{d.approved ? ' ✓' : ''}</button>
              ))}
            </div>
          )}
          <p className="muted" style={{ marginTop: 0 }}>
            Source: {doc.source === 'model' ? 'live model output' : 'recorded sample output (hand-made, not a live model)'}. Flagged fields come from code checks plus anything the model said it was unsure about; a field with no flag is not guaranteed correct.
          </p>
          <div className="split">
            <div className="preview" aria-label="Original document">
              {doc.preview.type === 'text' ? <pre>{doc.preview.text}</pre> : doc.preview.type === 'image' ? <img src={doc.preview.url} alt={`Uploaded document ${doc.name}`} /> : <embed src={doc.preview.url} type="application/pdf" />}
            </div>
            <ReviewForm
              invoice={doc.invoice}
              issues={issues}
              onChange={(invoice) => update({ invoice, approved: false })}
              approved={doc.approved}
              onApprove={() => update({ approved: true })}
              errors={errorCount(issues)}
            />
          </div>
        </section>
      )}

      {approved.length > 0 && (
        <section className="card" aria-labelledby="ex">
          <h2 id="ex">3. Export</h2>
          <p className="muted" style={{ marginTop: 0 }}>{approved.length} approved invoice{approved.length > 1 ? 's' : ''}. CSV has one row per line item. Nothing is stored on the server.</p>
          <div className="row">
            <button className="primary" onClick={() => download('invoices.csv', 'text/csv;charset=utf-8', toCsv(approved.map((d) => d.invoice)))}>Download CSV</button>
            <button onClick={() => download('invoices.json', 'application/json', JSON.stringify(approved.map((d) => d.invoice), null, 2))}>Download JSON</button>
          </div>
        </section>
      )}
    </div>
  );
}
