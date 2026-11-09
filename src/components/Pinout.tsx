import { buildPinout, type Drawable, type PinRole, R } from '../lib/pinout';

const ROLE_LABEL: Record<PinRole, string> = {
  power: 'Power',
  ground: 'Ground',
  input: 'Input',
  output: 'Output',
  io: 'I/O',
  nc: 'Not connected',
  other: 'Other',
};

const CAPTION = {
  dual: 'Top view. The notch marks the top; pin 1 is the dot.',
  single: 'Pin 1 is at the top.',
  'three-lead': 'Front view (flat or printed side facing you), pin 1 on the left.',
} as const;

interface Props extends Drawable {
  /** Written on the chip body, e.g. the part number. */
  title?: string | null;
}

/** A drawn pinout. Colours come from CSS (`.pin.<role>`), so it follows light and dark mode. */
export default function Pinout({ pins, layout, title }: Props) {
  const m = buildPinout(pins, layout);
  const roles = [...new Set(pins.map((p) => p.role))];
  const summary = `Pinout, ${pins.length} pins: ${pins.map((p) => `${p.number} ${p.name}`).join(', ')}`;
  // Two- and one-row bodies are narrow, so the part number runs vertically along the chip; it is shortened to fit.
  const rotated = layout !== 'three-lead';
  const room = rotated ? Math.floor((m.body.height - 32) / 7.5) : 16;
  const body = !title || room < 3 ? null : title.length > room ? `${title.slice(0, room - 1)}…` : title;

  return (
    <details className="pinout" open={pins.length <= 16}>
      <summary>Pinout diagram ({pins.length} pins)</summary>
      <svg viewBox={`0 0 ${m.width} ${m.height}`} style={{ maxWidth: m.width }} role="img" aria-label={summary}>
        <title>{summary}</title>
        <rect className="chip" x={m.body.x} y={m.body.y} width={m.body.width} height={m.body.height} rx={6} />
        {m.notch && <path className="notch" d={`M ${m.notch.x - 9} ${m.notch.y} A 9 9 0 0 0 ${m.notch.x + 9} ${m.notch.y}`} />}
        {m.pin1 && <circle className="pin1" cx={m.pin1.x} cy={m.pin1.y} r={4} />}
        {body && (
          <text
            className="chip-title"
            x={m.title.x}
            y={m.title.y}
            textAnchor="middle"
            dominantBaseline="central"
            transform={rotated ? `rotate(-90 ${m.title.x} ${m.title.y})` : undefined}
          >
            {body}
          </text>
        )}
        {m.pins.map((g) => (
          <g key={g.pin.number} className={`pin ${g.pin.role}`}>
            <line className="lead" x1={g.stub.x1} y1={g.stub.y1} x2={g.stub.x2} y2={g.stub.y2} />
            <circle cx={g.cx} cy={g.cy} r={R} />
            <text className="num" x={g.cx} y={g.cy} textAnchor="middle" dominantBaseline="central">
              {g.pin.number}
            </text>
            <text className="name" x={g.label.x} y={g.label.y} textAnchor={g.label.anchor} dominantBaseline="central">
              {g.pin.name}
            </text>
          </g>
        ))}
      </svg>
      <ul className="legend" aria-label="Pin colours">
        {roles.map((r) => (
          <li key={r} className={`pin ${r}`}>
            <span className="dot" />
            {ROLE_LABEL[r]}
          </li>
        ))}
      </ul>
      <small>{CAPTION[layout]}</small>
    </details>
  );
}
