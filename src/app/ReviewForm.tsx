'use client';

import { useId, useState } from 'react';
import { emptyLine, type InvoiceForm, type Issue, type LineForm, type TotalsForm } from '../lib/invoice';

interface FieldProps {
  label: string;
  value: string;
  path: string;
  issues: Issue[];
  onChange: (v: string) => void;
  hideLabel?: boolean;
}

function Field({ label, value, path, issues, onChange, hideLabel }: FieldProps) {
  const id = useId();
  const mine = issues.filter((i) => i.field === path);
  const hasError = mine.some((i) => i.severity === 'error');
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr' : undefined}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={hasError || undefined}
        aria-describedby={mine.length ? `${id}-m` : undefined}
        className={!hasError && mine.length ? 'warn' : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {mine.length > 0 && !hideLabel && (
        <div id={`${id}-m`}>
          {mine.map((m, i) => <div key={i} className={`msg ${m.severity}`}>{m.message}</div>)}
        </div>
      )}
      {mine.length > 0 && hideLabel && <span id={`${id}-m`} className="sr">{mine.map((m) => m.message).join(' ')}</span>}
    </div>
  );
}

const LINE_COLS: [keyof LineForm, string][] = [
  ['description', 'Description'], ['hsn', 'HSN/SAC'], ['quantity', 'Qty'], ['unit', 'Unit'], ['rate', 'Rate'],
  ['taxable', 'Taxable'], ['gstRate', 'GST %'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['total', 'Line total'],
];
const TOTAL_COLS: [keyof TotalsForm, string][] = [
  ['taxable', 'Taxable total'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['roundOff', 'Round-off'], ['grandTotal', 'Grand total'],
];

interface Props {
  invoice: InvoiceForm;
  issues: Issue[];
  errors: number;
  approved: boolean;
  onChange: (inv: InvoiceForm) => void;
  onApprove: () => void;
}

export function ReviewForm({ invoice, issues, errors, approved, onChange, onApprove }: Props) {
  const [override, setOverride] = useState(false);
  const warnings = issues.length - errors;
  const set = <K extends keyof InvoiceForm>(k: K, v: InvoiceForm[K]) => onChange({ ...invoice, [k]: v });
  const setLine = (i: number, k: keyof LineForm, v: string) =>
    set('lines', invoice.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const header: [keyof InvoiceForm, string][] = [
    ['supplierName', 'Supplier name'], ['supplierGstin', 'Supplier GSTIN'], ['buyerName', 'Buyer name'], ['buyerGstin', 'Buyer GSTIN'],
    ['invoiceNumber', 'Invoice number'], ['invoiceDate', 'Invoice date'], ['placeOfSupply', 'Place of supply'],
  ];
  const lineIssues = issues.filter((i) => i.field === 'lines' || i.field === '');

  return (
    <div>
      <div className={`summary ${errors ? 'bad' : warnings ? 'mid' : 'good'}`} role="status">
        {errors ? `${errors} error${errors > 1 ? 's' : ''} to fix` : 'No errors'}
        {warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''} to check` : ''}.
        {!errors && !warnings && ' All code checks pass.'}
      </div>

      <div className="grid2">
        {header.map(([k, label]) => (
          <Field key={k} label={label} path={k} value={invoice[k] as string} issues={issues} onChange={(v) => set(k, v as never)} />
        ))}
      </div>

      <h3 style={{ margin: '16px 0 6px', fontSize: 15 }}>Line items</h3>
      {lineIssues.map((m, i) => <div key={i} className={`msg ${m.severity}`}>{m.message}</div>)}
      <div className="tablewrap">
        <table>
          <caption className="sr">Line items</caption>
          <thead>
            <tr><th scope="col">#</th>{LINE_COLS.map(([, l]) => <th scope="col" key={l}>{l}</th>)}<th scope="col"><span className="sr">Remove</span></th></tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {LINE_COLS.map(([k, label]) => (
                  <td key={k} className={k === 'description' ? 'desc' : undefined}>
                    <Field label={`${label}, line ${i + 1}`} hideLabel path={`lines.${i}.${k}`} value={line[k]} issues={issues} onChange={(v) => setLine(i, k, v)} />
                  </td>
                ))}
                <td><button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => set('lines', invoice.lines.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" style={{ marginTop: 6 }} onClick={() => set('lines', [...invoice.lines, emptyLine()])}>Add line</button>

      <h3 style={{ margin: '16px 0 6px', fontSize: 15 }}>Totals</h3>
      <div className="grid2">
        {TOTAL_COLS.map(([k, label]) => (
          <Field key={k} label={label} path={`totals.${k}`} value={invoice.totals[k]} issues={issues} onChange={(v) => set('totals', { ...invoice.totals, [k]: v })} />
        ))}
      </div>

      {issues.length > 0 && (
        <details style={{ marginTop: 14 }} open={errors > 0}>
          <summary>All {issues.length} flag{issues.length > 1 ? 's' : ''}</summary>
          <ul className="issues">
            {issues.map((m, i) => <li key={i}><strong>{m.severity === 'error' ? 'Error' : 'Check'}:</strong> {m.field || 'document'}: {m.message}</li>)}
          </ul>
        </details>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        {errors > 0 && (
          <label>
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> I checked the document and approve it with the errors above
          </label>
        )}
        <button className="primary" disabled={approved || (errors > 0 && !override)} onClick={onApprove}>
          {approved ? 'Approved ✓' : 'Approve for export'}
        </button>
      </div>
    </div>
  );
}
