import { useMemo } from 'react';
import { layoutDiagram, wireKind } from '../lib/diagram';
import type { Diagram } from '../lib/types';

/** The wiring diagram, drawn by our own code from checked data. Colours come from CSS, so it follows light and dark mode. */
export default function DiagramView({ diagram }: { diagram: Diagram }) {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram]);
  const links = diagram.nets.map((n) => `${n.name}: ${n.ends.map((e) => `${e.ref}.${e.pin}`).join(' – ')}`);
  return (
    <figure className="diagram">
      <div className="diagram-scroll">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="img"
          aria-label={`Wiring diagram. ${links.join('. ')}`}
        >
          <title>Wiring diagram</title>
          {layout.wires.map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: wires are derived from the diagram and never reorder on their own
            <g key={i} className={`wire ${wireKind(w.net)} n${w.index % 6}`}>
              <path d={w.d} />
              <text x={w.label.x} y={w.label.y} textAnchor="middle">
                {w.net}
              </text>
            </g>
          ))}
          {layout.parts.map(({ part, x, y, w, h }) => (
            <g key={part.ref} className={`dg-part${part.external ? ' external' : ''}`}>
              <rect className="dg-box" x={x} y={y} width={w} height={h} rx={8} />
              <text className="dg-ref" x={x + 10} y={y + 19}>
                {part.ref}
              </text>
              <text className="dg-label" x={x + 40} y={y + 19}>
                {part.label.length > 17 ? `${part.label.slice(0, 16)}…` : part.label}
              </text>
              {part.pins.map((pin, i) => (
                <g key={pin.name} className={`dg-pin ${pin.role}`}>
                  <circle className="dg-dot" cx={x + 14} cy={y + 30 + 8 + i * 20 + 10} r={4} />
                  <text x={x + 26} y={y + 30 + 8 + i * 20 + 14}>
                    {pin.name}
                  </text>
                </g>
              ))}
              {part.pins.length === 0 && (
                <text className="dg-none" x={x + 12} y={y + 30 + 8 + 14}>
                  not wired
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <figcaption>
        <strong>Connections</strong>
        <ul>
          {links.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
