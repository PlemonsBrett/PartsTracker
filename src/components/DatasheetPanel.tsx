import { useState } from 'react';
import { clearDatasheet, findDatasheet, openDatasheetFile } from '../lib/datasheets';
import { plural } from '../lib/format';
import type { Item } from '../lib/types';

const TOP_SPECS = 5;

interface Props {
  item: Item;
  onChanged: () => Promise<void>;
}

export default function DatasheetPanel({ item, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const facts = item.fact_sheet;
  const attached = Boolean(facts || item.datasheet_path);
  const restSpecs = facts ? facts.specs.slice(TOP_SPECS) : [];
  const hasMore = restSpecs.length > 0 || Boolean(facts && (facts.features.length > 0 || facts.pinout));

  async function run(job: () => Promise<string | undefined>) {
    setBusy(true);
    setMsg('');
    try {
      setMsg((await job()) ?? '');
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const lookup = () =>
    run(async () => {
      const r = await findDatasheet(item.id);
      return r.status === 'found' ? undefined : 'No matching datasheet found. Adding a part number or manufacturer helps.';
    });

  const specRows = (rows: { name: string; value: string }[]) => (
    <dl className="specs">
      {rows.map((s) => (
        <div key={s.name}>
          <dt>{s.name}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section className="datasheet" aria-label="Datasheet">
      <div className="datasheet-head">
        <h3>Datasheet</h3>
        {item.datasheet_url && (
          <a href={item.datasheet_url} target="_blank" rel="noreferrer noopener">
            Source ↗
          </a>
        )}
      </div>

      {facts && (
        <div className="facts">
          {facts.summary && <p>{facts.summary}</p>}
          {specRows(facts.specs.slice(0, TOP_SPECS))}
          {hasMore && (
            <details className="more">
              <summary>{restSpecs.length > 0 ? `${plural(restSpecs.length, 'more spec')}, ` : ''}features &amp; pinout</summary>
              {restSpecs.length > 0 && specRows(restSpecs)}
              {facts.features.length > 0 && (
                <ul>
                  {facts.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {facts.pinout && <p className="pinout">Pinout: {facts.pinout}</p>}
            </details>
          )}
          <small>Parsed from the datasheet; verify critical values against the source.</small>
        </div>
      )}

      {!facts && item.datasheet_path && (
        <p>
          Specs couldn't be parsed, so the PDF is attached.{' '}
          <button type="button" onClick={() => run(async () => void (await openDatasheetFile(item.datasheet_path as string)))}>
            Open PDF
          </button>
        </p>
      )}

      {!attached && item.datasheet_status === 'not_found' && <p className="hint">No datasheet found automatically.</p>}
      {!attached && item.datasheet_status !== 'not_found' && <p className="hint">Nothing attached yet.</p>}

      <div className="actions">
        <button type="button" disabled={busy} onClick={lookup}>
          {busy ? 'Working…' : attached ? '↻ Look up again' : '🔎 Find datasheet'}
        </button>
        {attached && (
          <button type="button" className="danger" disabled={busy} onClick={() => run(async () => void (await clearDatasheet(item)))}>
            Remove
          </button>
        )}
      </div>
      {msg && <p className="msg">{msg}</p>}
    </section>
  );
}
