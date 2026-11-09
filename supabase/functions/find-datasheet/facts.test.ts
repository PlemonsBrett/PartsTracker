import { describe, expect, it } from 'vitest';
import { buildPrompt, checkUrl, collectHosts, downloadPdf, sanitizeFacts, sanitizePins } from './facts.ts';

const pdf = (extra = '') => new TextEncoder().encode(`%PDF-1.7 ${extra}`);
const resp = (body: Uint8Array | null, init: ResponseInit = {}) => new Response(body as BodyInit | null, init);

describe('checkUrl', () => {
  it('accepts plain https URLs', () => expect(checkUrl('https://www.ti.com/lit/ds/symlink/lm358.pdf')?.hostname).toBe('www.ti.com'));
  it.each([
    'http://example.com/a.pdf',
    'https://localhost/a.pdf',
    'https://127.0.0.1/a.pdf',
    'https://2130706433/a.pdf',
    'https://[::1]/a.pdf',
    'https://169.254.169.254/latest',
    'https://printer.local/a.pdf',
    'https://intranet/a.pdf',
    'https://user:pw@example.com/a.pdf',
    'https://example.com:8443/a.pdf',
    'file:///etc/passwd',
    'not a url',
  ])('rejects %s', (u) => expect(checkUrl(u)).toBeNull());
});

describe('sanitizeFacts', () => {
  it('clamps and filters model output', () => {
    const f = sanitizeFacts(
      {
        summary: 'x'.repeat(1000),
        specs: [
          { name: 'Vcc', value: '3-5.5 V' },
          { name: '', value: 'bad' },
          { name: 'bad', value: 5 },
          ...Array.from({ length: 40 }, (_, i) => ({ name: `s${i}`, value: 'v' })),
        ],
        features: ['a', 7, 'b'],
        pinout: '1 VCC',
      },
      'https://a.com/x.pdf',
      new Date('2026-01-01T00:00:00Z'),
    )!;
    expect(f.summary).toHaveLength(400);
    expect(f.specs).toHaveLength(20);
    expect(f.specs[0]).toEqual({ name: 'Vcc', value: '3-5.5 V' });
    expect(f.features).toEqual(['a', 'b']);
    expect(f.extracted_at).toBe('2026-01-01T00:00:00.000Z');
  });
  it('returns null when nothing usable', () => {
    expect(sanitizeFacts({ specs: [{ name: 'a' }] }, 'https://a.com')).toBeNull();
    expect(sanitizeFacts(undefined, 'https://a.com')).toBeNull();
  });
});

describe('collectHosts', () => {
  it('reads urls from search and fetch results only', () => {
    const hosts = collectHosts([
      { type: 'text', text: 'see https://evil.example/x', url: 'https://nope.com' },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.ti.com/lit/a.pdf' }] },
      { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: 'https://www.st.com/b.pdf' } },
      { type: 'web_search_tool_result', content: [{ url: 'http://insecure.com/a' }] },
    ]);
    expect([...hosts].sort()).toEqual(['www.st.com', 'www.ti.com']);
  });
});

describe('downloadPdf', () => {
  it('downloads a PDF', async () => {
    const r = await downloadPdf('https://a.com/x.pdf', async () => resp(pdf(), { status: 200 }));
    expect(r.ok).toBe(true);
  });
  it('follows redirects but re-validates each hop', async () => {
    const hops: string[] = [];
    const fake = (async (u: URL) => {
      hops.push(String(u));
      return hops.length === 1 ? resp(null, { status: 302, headers: { location: 'https://cdn.a.com/y.pdf' } }) : resp(pdf());
    }) as unknown as typeof fetch;
    expect((await downloadPdf('https://a.com/x.pdf', fake)).ok).toBe(true);
    expect(hops).toEqual(['https://a.com/x.pdf', 'https://cdn.a.com/y.pdf']);

    const evil = (async () => resp(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) as unknown as typeof fetch;
    expect(await downloadPdf('https://a.com/x.pdf', evil)).toEqual({ ok: false, reason: 'URL not allowed' });
  });
  it('rejects non-PDFs, oversize bodies and loops', async () => {
    const html = (async () => resp(new TextEncoder().encode('<html>'))) as unknown as typeof fetch;
    expect(await downloadPdf('https://a.com/x', html)).toEqual({ ok: false, reason: 'not a PDF' });
    const big = (async () => resp(pdf('x'.repeat(200)))) as unknown as typeof fetch;
    expect(await downloadPdf('https://a.com/x', big, { maxBytes: 100 })).toEqual({ ok: false, reason: 'too large' });
    const loop = (async () => resp(null, { status: 302, headers: { location: 'https://a.com/x' } })) as unknown as typeof fetch;
    expect(await downloadPdf('https://a.com/x', loop)).toEqual({ ok: false, reason: 'too many redirects' });
  });
});

describe('buildPrompt', () => {
  it('includes only known fields', () => {
    const p = buildPrompt({ name: 'LM358', manufacturer: 'TI', part_number: null });
    expect(p).toContain('Manufacturer: TI');
    expect(p).not.toContain('Part number');
  });
});

describe('sanitizePins', () => {
  const dip8 = [
    { number: 1, name: 'GAIN', role: 'input' },
    { number: 2, name: '-INPUT', role: 'input' },
    { number: 3, name: '+INPUT', role: 'input' },
    { number: 4, name: 'GND', role: 'ground' },
    { number: 5, name: 'VOUT', role: 'output' },
    { number: 6, name: 'VS', role: 'power' },
    { number: 7, name: 'BYPASS', role: 'other' },
    { number: 8, name: 'GAIN', role: 'input' },
  ];
  it('accepts a complete dual-row pin list, sorted by number', () => {
    const r = sanitizePins([...dip8].reverse(), 'dual')!;
    expect(r.layout).toBe('dual');
    expect(r.pins.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('rejects gaps, duplicates, odd counts and unknown layouts', () => {
    expect(sanitizePins(dip8.slice(0, 7), 'dual')).toBeNull(); // odd count for dual
    expect(
      sanitizePins(
        dip8.filter((p) => p.number !== 3),
        'dual',
      ),
    ).toBeNull(); // gap
    expect(sanitizePins([...dip8.slice(0, 7), { number: 7, name: 'X', role: 'io' }], 'dual')).toBeNull(); // duplicate
    expect(sanitizePins(dip8, 'qfp')).toBeNull();
    expect(sanitizePins(undefined, 'dual')).toBeNull();
  });
  it('checks the count against the layout', () => {
    expect(sanitizePins(dip8, 'three-lead')).toBeNull();
    expect(sanitizePins(dip8.slice(0, 3), 'three-lead')).not.toBeNull();
    expect(sanitizePins(dip8.slice(0, 2), 'single')).not.toBeNull();
    expect(sanitizePins(dip8.slice(0, 1), 'single')).toBeNull();
  });
  it('rejects pins without a name or with a non-integer number; unknown roles become "other"', () => {
    expect(
      sanitizePins(
        [
          { number: 1, name: '', role: 'io' },
          { number: 2, name: 'B', role: 'io' },
        ],
        'single',
      ),
    ).toBeNull();
    expect(
      sanitizePins(
        [
          { number: 1.5, name: 'A', role: 'io' },
          { number: 2, name: 'B', role: 'io' },
        ],
        'single',
      ),
    ).toBeNull();
    expect(
      sanitizePins(
        [
          { number: 1, name: 'A', role: 'banana' },
          { number: 2, name: 'B', role: 'io' },
        ],
        'single',
      )!.pins[0].role,
    ).toBe('other');
  });
  it('sanitizeFacts keeps valid pins and drops invalid ones without losing the rest', () => {
    const good = sanitizeFacts({ summary: 's', pins: dip8, layout: 'dual' }, 'https://a.com')!;
    expect(good.pins).toHaveLength(8);
    expect(good.layout).toBe('dual');
    const bad = sanitizeFacts({ summary: 's', pins: dip8.slice(0, 5), layout: 'dual' }, 'https://a.com')!;
    expect(bad.summary).toBe('s');
    expect('pins' in bad).toBe(false);
  });
  it('pins alone are enough to keep a fact sheet', () => {
    expect(sanitizeFacts({ pins: dip8, layout: 'dual' }, 'https://a.com')).not.toBeNull();
  });
});
