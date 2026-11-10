// Pure helpers for investigate-item (no Deno or network imports, so they run under vitest).

export interface Step {
  title: string;
  /** One of the user's tools by name, or "No tool needed". */
  tool: string;
  instructions: string;
  expect: string;
  caution: string | null;
}

export interface Plan {
  goal: string;
  safety: string[];
  steps: Step[];
  missing_tools: string[];
  /** What to write down, to bring back into "Update from photos & notes". */
  record: string;
}

export interface ToolInfo {
  kind: string;
  name: string;
  notes: string | null;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max: number, each: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => clip(x, each))
    .filter(Boolean)
    .slice(0, max);

export const NO_TOOL = 'No tool needed';

export const SUPPLY_SAFETY =
  'Before powering a part from the bench supply: keep the output off while wiring, set the voltage first, and set a low current limit (start around 50 mA).';

/**
 * The model's plan is untrusted text: clamp every field and drop steps with no instructions.
 * A step naming a tool the user does not own is kept but relabelled, so it never reads like a step they can do now.
 * A plan with a powered step always carries a current-limit warning, whatever the model chose to write.
 */
export function sanitizePlan(raw: unknown, tools: Pick<ToolInfo, 'name' | 'kind'>[]): Plan | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const owned = new Map(tools.map((t) => [t.name.toLowerCase(), t]));
  let usesSupply = false;
  const steps: Step[] = (Array.isArray(r.steps) ? r.steps : [])
    .map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      const said = clip(x.tool, 60);
      const mine = owned.get(said.toLowerCase());
      if (mine?.kind === 'power_supply') usesSupply = true;
      const tool = !said || /^no tool/i.test(said) ? NO_TOOL : (mine?.name ?? `${said} (you don't have this)`);
      return {
        title: clip(x.title, 80),
        tool,
        instructions: clip(x.instructions, 700),
        expect: clip(x.expect, 400),
        caution: clip(x.caution, 250) || null,
      };
    })
    .filter((s) => s.title && s.instructions)
    .slice(0, 10);
  if (steps.length === 0) return null;
  const safety = list(r.safety, 6, 250);
  if (usesSupply && !safety.some((line) => /current/i.test(line))) safety.unshift(SUPPLY_SAFETY);
  return {
    goal: clip(r.goal, 300),
    safety: safety.slice(0, 6),
    steps,
    missing_tools: list(r.missing_tools, 4, 80),
    record: clip(r.record, 300),
  };
}

const SHOWN = ['name', 'category', 'value', 'package', 'part_number', 'manufacturer', 'description', 'notes'] as const;

export function buildPrompt(item: Record<string, unknown>, tools: ToolInfo[], unknowns: string[], context: string): string {
  const known = Object.fromEntries(SHOWN.filter((k) => item[k]).map((k) => [k, item[k]]));
  const owned = tools.length
    ? tools.map((t) => `- ${t.name} (${t.kind.replace('_', ' ')})${t.notes ? `: ${t.notes}` : ''}`).join('\n')
    : '(none listed)';
  return `A hobbyist wants to find out what an electronics part is, or confirm some of its details, by testing it.

What is saved about the part:
${JSON.stringify(known, null, 2)}

What is not known yet: ${unknowns.length ? unknowns.map((u) => `"${u}"`).join(', ') : 'not specified (work out what is worth confirming from the details above)'}.
${context ? `\nExtra context from the owner:\n"""\n${context}\n"""\n` : ''}
Test equipment the owner has (use these exact names):
${owned}

Call propose_plan once with a short test plan.
Rules:
- Order matters: look first (markings, orientation), then tests with the part unpowered (continuity, resistance, diode test, capacitance), and only then powered tests. Powered tests must be the last steps.
- Write each step for the owner's actual tool, in terms of what that instrument offers (modes, jacks, buttons, ranges). If you are not sure how a model-specific control works, say what to look for or to check the manual. Do not invent button sequences. You may search the web to check the part or an instrument's controls.
- Name tools exactly as listed. If a useful test needs a tool they do not have, put it in "missing_tools" and do not make a step that depends on it. If they have no suitable tool, offer the safest tests that need none.
- Each step says what to do, what a good reading looks like, and what it means. Use real numbers when you know them.
- Safety is part of the plan: list the main risks in "safety". For any powered step, give concrete limits for their supply (set the voltage first with the output off, a low current limit, correct polarity, and when to stop). Never use a bench supply on a part whose voltage rating is unknown without starting low. Never suggest testing anything connected to mains voltage; if the part might be, say not to test it.
- Do not suggest tests beyond the ratings of their tools.
- At most 8 steps, each short. "goal" says what the tests will settle. "record" says what to write down so the owner can bring the results back to update the part.`;
}

export const PLAN_TOOL = {
  name: 'propose_plan',
  description: 'Propose the test plan. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      safety: { type: 'array', items: { type: 'string' } },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            tool: { type: 'string', description: `One of the owner's tools by exact name, or "${NO_TOOL}"` },
            instructions: { type: 'string' },
            expect: { type: 'string', description: 'What a good reading looks like and what it means' },
            caution: { type: 'string', description: 'Only if this step carries a specific risk' },
          },
          required: ['title', 'tool', 'instructions', 'expect'],
        },
      },
      missing_tools: { type: 'array', items: { type: 'string' } },
      record: { type: 'string' },
    },
    required: ['goal', 'steps'],
  },
};
