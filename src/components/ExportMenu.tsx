import { useState } from 'react';
import { download, toCSV, toJSON, toMarkdown } from '../lib/export';
import type { Item } from '../lib/types';

export default function ExportMenu({ items, label }: { items: Item[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const fns = { json: toJSON, md: toMarkdown, csv: toCSV };

  async function copy(kind: 'json' | 'md') {
    await navigator.clipboard.writeText(fns[kind](items));
    setCopied(kind);
    setTimeout(() => setCopied(''), 1500);
  }
  const save = (kind: 'json' | 'md' | 'csv') => {
    const mime = { json: 'application/json', md: 'text/markdown', csv: 'text/csv' }[kind];
    download(`inventory.${kind}`, fns[kind](items), mime);
  };

  return (
    <div className="menu">
      <button type="button" onClick={() => setOpen(!open)}>
        Export
      </button>
      {open && (
        <>
          <button type="button" className="menu-backdrop" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="pop">
            <small>{label}</small>
            <button type="button" onClick={() => copy('md')}>
              {copied === 'md' ? '✓ Copied' : 'Copy Markdown (for agents)'}
            </button>
            <button type="button" onClick={() => copy('json')}>
              {copied === 'json' ? '✓ Copied' : 'Copy JSON'}
            </button>
            <hr />
            <button type="button" onClick={() => save('json')}>
              Download .json
            </button>
            <button type="button" onClick={() => save('md')}>
              Download .md
            </button>
            <button type="button" onClick={() => save('csv')}>
              Download .csv
            </button>
          </div>
        </>
      )}
    </div>
  );
}
