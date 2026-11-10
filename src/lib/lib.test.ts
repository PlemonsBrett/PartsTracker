import { describe, expect, it } from 'vitest';
import { cleanTranscript, makeProgress } from './audio';
import { toCSV, toMarkdown } from './export';
import { plural } from './format';
import { compileResults, hasProgress, needsInvestigation, setStepNote, toggleDone } from './investigate';
import { mergeNote, nextQuantity, unknownsOf } from './items';
import { acceptedCount, buildPatch, type Refinement } from './refine';
import { searchItems } from './search';
import { actionFor, isTypingTarget, moveSelection } from './shortcuts';
import { swipeAction } from './swipe';
import { cleanTool } from './tools';
import type { Item } from './types';
import { nextUndo } from './undo';

const mk = (o: Partial<Item>): Item => ({
  id: crypto.randomUUID(),
  name: 'x',
  category: null,
  quantity: 1,
  min_quantity: 0,
  location: null,
  part_number: null,
  manufacturer: null,
  value: null,
  package: null,
  description: null,
  datasheet_url: null,
  notes: null,
  updated_at: '',
  fact_sheet: null,
  datasheet_path: null,
  datasheet_status: null,
  datasheet_checked_at: null,
  pinout: null,
  investigation: null,
  ...o,
});
const items = [
  mk({ name: 'Resistor', category: 'Resistor', value: '10kΩ', package: '0805', location: 'A3' }),
  mk({ name: 'ATmega328P', category: 'IC', package: 'DIP-28' }),
];

describe('search', () => {
  it('matches values ignoring ohm symbol and case', () => expect(searchItems(items, '10K 0805')).toHaveLength(1));
  it('requires every term', () => expect(searchItems(items, 'atmega 0805')).toHaveLength(0));
  it('empty query returns all', () => expect(searchItems(items, '  ')).toHaveLength(2));
});

describe('nextQuantity', () => {
  it('adds, removes (floored at 0) and sets', () => {
    expect(nextQuantity(5, { op: 'add', quantity: 3 })).toBe(8);
    expect(nextQuantity(2, { op: 'remove', quantity: 5 })).toBe(0);
    expect(nextQuantity(2, { op: 'set', quantity: 40 })).toBe(40);
  });
});

describe('export', () => {
  it('escapes CSV', () => expect(toCSV([mk({ name: 'a,"b"' })]).split('\n')[1]).toMatch(/^"a,""b""",/));
  it('renders a markdown table', () => expect(toMarkdown(items)).toContain('| Resistor | 1 | Resistor | 10kΩ | 0805 |'));
});

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'part')).toBe('1 part');
    expect(plural(1, 'unit')).toBe('1 unit');
    expect(plural(0, 'part')).toBe('0 parts');
    expect(plural(2, 'unit')).toBe('2 units');
  });
  it('supports irregular plurals', () => expect(plural(2, 'box', 'boxes')).toBe('2 boxes'));
});

describe('nextUndo', () => {
  const item = { id: 'a', name: '10k resistor', quantity: 10 };
  it('remembers the value before the change', () => {
    expect(nextUndo(null, item, 11)).toEqual({ id: 'a', name: '10k resistor', from: 10, to: 11 });
  });
  it('collapses rapid changes to the same item so Undo goes back to the start', () => {
    const first = nextUndo(null, item, 11);
    const second = nextUndo(first, { ...item, quantity: 11 }, 12);
    expect(second).toMatchObject({ from: 10, to: 12 });
  });
  it('starts fresh when a different item changes', () => {
    const first = nextUndo(null, item, 11);
    expect(nextUndo(first, { id: 'b', name: 'LED', quantity: 5 }, 4)).toMatchObject({ id: 'b', from: 5, to: 4 });
  });
  it('offers nothing when the change nets out to zero', () => {
    const first = nextUndo(null, item, 11);
    expect(nextUndo(first, { ...item, quantity: 11 }, 10)).toBeNull();
  });
});

describe('swipeAction', () => {
  it('right is +1 and left is -1 once far enough', () => {
    expect(swipeAction(90, 5)).toBe('inc');
    expect(swipeAction(-90, -5)).toBe('dec');
  });
  it('ignores short drags', () => expect(swipeAction(40, 0)).toBeNull());
  it('ignores mostly vertical movement (scrolling)', () => {
    expect(swipeAction(80, 70)).toBeNull();
    expect(swipeAction(-80, 120)).toBeNull();
  });
});

describe('mergeNote', () => {
  it('uses the note when the part has none', () => expect(mergeNote(null, ' Top pin unreadable ')).toBe('Top pin unreadable'));
  it('appends below existing notes', () =>
    expect(mergeNote('Bought at Micro Center', 'Chip marking HM-10')).toBe('Bought at Micro Center\nChip marking HM-10'));
  it('does not repeat a note that is already saved', () => expect(mergeNote('Chip marking HM-10', 'Chip marking HM-10')).toBeNull());
  it('does nothing without a note', () => {
    expect(mergeNote('x', undefined)).toBeNull();
    expect(mergeNote('x', '   ')).toBeNull();
  });
});

describe('refine: what gets saved', () => {
  const r: Refinement = {
    changes: [
      { field: 'package', from: '3-pin header', to: '3-pin breakout board' },
      { field: 'manufacturer', from: null, to: 'ASAIR' },
    ],
    notes_add: 'Serial SNJ123',
    pinout: {
      layout: 'single',
      pins: [
        { number: 1, name: 'DATA', role: 'io' },
        { number: 2, name: 'VCC', role: 'power' },
      ],
    },
    summary: 's',
    uncertain: [],
  };
  const none = { fields: new Set<never>(), notes: false, pinout: false };

  it('accepting nothing changes nothing', () => {
    expect(buildPatch({ notes: 'old' }, r, none)).toEqual({});
    expect(acceptedCount(r, none)).toBe(0);
  });
  it('only the accepted fields are written', () => {
    const patch = buildPatch({ notes: null }, r, { ...none, fields: new Set(['manufacturer'] as const) });
    expect(patch).toEqual({ manufacturer: 'ASAIR' });
  });
  it('a new note is added below the existing notes, never replacing them', () => {
    expect(buildPatch({ notes: 'old' }, r, { ...none, notes: true }).notes).toBe('old\nSerial SNJ123');
  });
  it('a pinout read from photos is saved with that source', () => {
    const patch = buildPatch({ notes: null }, r, { ...none, pinout: true });
    expect(patch.pinout?.source).toBe('photo');
    expect(patch.pinout?.pins).toHaveLength(2);
  });
  it('counts what is accepted', () => {
    expect(acceptedCount(r, { fields: new Set(['package', 'manufacturer'] as const), notes: true, pinout: true })).toBe(4);
  });
});

describe('unknownsOf', () => {
  it('lists what the model could not determine, trimmed', () => {
    expect(unknownsOf({ confidence: 'medium', unknowns: [' pin order ', '', 'voltage rating'] })).toEqual(['pin order', 'voltage rating']);
  });
  it('a "low" confidence with no detail still means something is unknown', () => {
    expect(unknownsOf({ confidence: 'low', unknowns: [] })).toEqual(['what this part is']);
    expect(unknownsOf({ confidence: 'low' })).toEqual(['what this part is']);
  });
  it('a confident answer with nothing listed has nothing to investigate', () => {
    expect(unknownsOf({ confidence: 'high', unknowns: [] })).toEqual([]);
    expect(unknownsOf({})).toEqual([]);
  });
});

describe('needsInvestigation', () => {
  const inv = (o: object) => ({ investigation: { unknowns: ['x'], ...o } });
  it('is true while something is unknown and not resolved', () => expect(needsInvestigation(inv({}))).toBe(true));
  it('is false once resolved, or with nothing unknown, or no investigation', () => {
    expect(needsInvestigation(inv({ resolved: true }))).toBe(false);
    expect(needsInvestigation(inv({ unknowns: [] }))).toBe(false);
    expect(needsInvestigation({ investigation: null })).toBe(false);
  });
});

describe('toggleDone', () => {
  it('adds a step in order and removes it again', () => {
    expect(toggleDone([0, 2], 1)).toEqual([0, 1, 2]);
    expect(toggleDone([0, 1, 2], 1)).toEqual([0, 2]);
  });
  it('does not change the original', () => {
    const d = [1];
    toggleDone(d, 0);
    expect(d).toEqual([1]);
  });
});

describe('cleanTool', () => {
  it('trims, caps lengths and turns empty notes into null', () => {
    expect(cleanTool({ kind: 'multimeter', name: '  FNIRSI DMT-99 ', notes: '   ' })).toEqual({
      kind: 'multimeter',
      name: 'FNIRSI DMT-99',
      notes: null,
    });
    expect(cleanTool({ kind: 'other', name: 'x'.repeat(200), notes: 'y'.repeat(900) })?.name).toHaveLength(80);
    expect(cleanTool({ kind: 'other', name: 'x', notes: 'y'.repeat(900) })?.notes).toHaveLength(600);
  });
  it('needs a name', () => expect(cleanTool({ kind: 'other', name: '   ', notes: 'n' })).toBeNull());
});

describe('cleanTranscript', () => {
  it('trims and collapses whitespace', () =>
    expect(cleanTranscript('  bought   fifty 10k   resistors \n')).toBe('bought fifty 10k resistors'));
  it('drops the markers Whisper writes for silence', () => {
    for (const t of ['[BLANK_AUDIO]', ' [BLANK_AUDIO] ', '(silence)', '[ Silence ]', '*music*', '♪', '', '   '])
      expect(cleanTranscript(t), t).toBe('');
    expect(cleanTranscript(null)).toBe('');
  });
  it('keeps real speech, including text with brackets or numbers', () => {
    expect(cleanTranscript('Used four ATmega328P.')).toBe('Used four ATmega328P.');
    expect(cleanTranscript('Added the 10k resistor (0805) to bin A3')).toBe('Added the 10k resistor (0805) to bin A3');
  });
});

describe('makeProgress', () => {
  it('combines per-file downloads into one percentage', () => {
    const p = makeProgress();
    expect(p('a.onnx', 50, 100)).toBe(50);
    expect(p('b.onnx', 0, 100)).toBe(25);
    expect(p('b.onnx', 100, 100)).toBe(75);
    expect(p('a.onnx', 100, 100)).toBe(100);
  });
  it('is 0 before sizes are known and never passes 100', () => {
    const p = makeProgress();
    expect(p('a', 0, 0)).toBe(0);
    expect(p('a', 150, 100)).toBe(100);
  });
});

describe('keyboard shortcuts', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });
  const free = { typing: false, modalOpen: false, inSearch: false };

  it('maps single keys to commands on the list', () => {
    const want: Record<string, string> = {
      '/': 'search',
      c: 'capture',
      n: 'add',
      j: 'next',
      ArrowDown: 'next',
      k: 'prev',
      ArrowUp: 'prev',
      Enter: 'open',
      '+': 'inc',
      '=': 'inc',
      '-': 'dec',
      '?': 'help',
      Escape: 'clear',
    };
    for (const [k, a] of Object.entries(want)) expect(actionFor(key(k), free), k).toBe(a);
    expect(actionFor(key('x'), free)).toBeNull();
  });
  it('does nothing while typing in a field or while a dialog is open', () => {
    expect(actionFor(key('c'), { ...free, typing: true })).toBeNull();
    expect(actionFor(key('c'), { ...free, modalOpen: true })).toBeNull();
    expect(actionFor(key('Escape'), { ...free, modalOpen: true })).toBeNull();
  });
  it('leaves browser shortcuts alone when Ctrl, Cmd or Alt is held', () => {
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(actionFor(key('c', mods), free)).toBeNull();
  });
  it('in the search box only arrows, Enter and Escape act', () => {
    const search = { typing: true, modalOpen: false, inSearch: true };
    expect(actionFor(key('ArrowDown'), search)).toBe('next');
    expect(actionFor(key('Enter'), search)).toBe('open');
    expect(actionFor(key('Escape'), search)).toBe('clear');
    expect(actionFor(key('c'), search)).toBeNull();
    expect(actionFor(key('j'), search)).toBeNull();
  });
  it('recognises text fields but not checkboxes or buttons', () => {
    const el = (tagName: string, type = '') => ({ tagName, type, isContentEditable: false }) as unknown as Element;
    expect(isTypingTarget(el('INPUT', 'text'))).toBe(true);
    expect(isTypingTarget(el('INPUT', 'search'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('INPUT', 'checkbox'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('moveSelection', () => {
  it('first press selects the first or last row', () => {
    expect(moveSelection(-1, 5, 1)).toBe(0);
    expect(moveSelection(-1, 5, -1)).toBe(4);
  });
  it('moves one row and stops at the ends', () => {
    expect(moveSelection(2, 5, 1)).toBe(3);
    expect(moveSelection(4, 5, 1)).toBe(4);
    expect(moveSelection(0, 5, -1)).toBe(0);
  });
  it('has nothing to select in an empty list', () => expect(moveSelection(0, 0, 1)).toBe(-1));
});

describe('step notes', () => {
  const plan = {
    steps: [
      { title: 'Look for markings', tool: 'No tool needed', instructions: 'i', expect: 'e', caution: null },
      { title: 'Resistance between pins', tool: 'FNIRSI DMT-99', instructions: 'i', expect: 'e', caution: null },
      { title: 'First power-up', tool: 'Kungber SPS3010', instructions: 'i', expect: 'e', caution: null },
    ],
  };

  it('stores a note by step position and removes it when emptied', () => {
    const a = setStepNote({}, 1, '5.1k between 1 and 2');
    expect(a).toEqual({ '1': '5.1k between 1 and 2' });
    expect(setStepNote(a, 0, 'CNT5')).toEqual({ '0': 'CNT5', '1': '5.1k between 1 and 2' });
    expect(setStepNote(a, 1, '   ')).toEqual({});
  });
  it('does not change the notes it was given', () => {
    const a = { '0': 'x' };
    setStepNote(a, 1, 'y');
    expect(a).toEqual({ '0': 'x' });
  });
  it('knows whether anything would be lost', () => {
    expect(hasProgress([], {})).toBe(false);
    expect(hasProgress([], { '0': '  ' })).toBe(false);
    expect(hasProgress([0], {})).toBe(true);
    expect(hasProgress([], { '2': 'hot' })).toBe(true);
  });
  it('compiles results in plan order, skipping steps with nothing', () => {
    const text = compileResults(plan, [0, 1], { '1': '5.1k between pins 1 and 2', '2': 'drew 12 mA at 3.3 V' });
    expect(text).toBe(
      'Test results:\n1. Look for markings ✓\n2. Resistance between pins (FNIRSI DMT-99) ✓: 5.1k between pins 1 and 2\n3. First power-up (Kungber SPS3010): drew 12 mA at 3.3 V\n',
    );
  });
  it('indents extra lines of a note under its step', () => {
    expect(compileResults(plan, [], { '0': 'line one\nline two' })).toContain('1. Look for markings: line one\n   line two');
  });
  it('is just the heading when nothing has been done, and survives no plan', () => {
    expect(compileResults(plan, [], {})).toBe('Test results:\n');
    expect(compileResults(null, [0], { '0': 'x' })).toBe('Test results:\n');
  });
});
