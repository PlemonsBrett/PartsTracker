export interface Item {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  min_quantity: number;
  location: string | null;
  part_number: string | null;
  manufacturer: string | null;
  value: string | null;
  package: string | null;
  description: string | null;
  datasheet_url: string | null;
  notes: string | null;
  updated_at: string;
  fact_sheet: FactSheet | null;
  datasheet_path: string | null;
  datasheet_status: 'found' | 'not_found' | null;
  datasheet_checked_at: string | null;
  pinout: UserPinout | null;
  investigation: Investigation | null;
}

/** Key specs parsed from a datasheet, so nobody has to read the whole PDF. */
export type Layout = 'dual' | 'single' | 'three-lead';
export type PinRole = 'power' | 'ground' | 'input' | 'output' | 'io' | 'nc' | 'other';
export interface Pin {
  number: number;
  name: string;
  role: PinRole;
}

export type ToolKind =
  | 'multimeter'
  | 'oscilloscope'
  | 'power_supply'
  | 'soldering_iron'
  | 'logic_analyzer'
  | 'function_generator'
  | 'lcr_meter'
  | 'other';

/** A piece of the user's test equipment, so test instructions can name their actual tools. */
export interface Tool {
  id: string;
  kind: ToolKind;
  name: string;
  notes: string | null;
}

export interface TestStep {
  title: string;
  tool: string;
  instructions: string;
  expect: string;
  caution: string | null;
}

export interface TestPlan {
  goal: string;
  safety: string[];
  steps: TestStep[];
  missing_tools: string[];
  record: string;
}

/** What a part still needs investigating, its test plan, and which steps are ticked off. */
export interface Investigation {
  unknowns: string[];
  plan?: TestPlan;
  done?: number[];
  /** What the owner wrote for each step, keyed by the step's position ("0" is the first). */
  notes?: Record<string, string>;
  resolved?: boolean;
}

/** A pinout owned by the user: typed in, or read from their photos. Takes precedence over the datasheet's. */
export interface UserPinout {
  layout: Layout;
  pins: Pin[];
  source: 'manual' | 'photo';
}

export interface FactSheet {
  summary: string;
  specs: { name: string; value: string }[];
  features: string[];
  pinout: string | null;
  /** Structured pins and package layout, used to draw the pinout diagram. */
  pins?: Pin[];
  layout?: Layout;
  source_url: string;
  extracted_at: string;
}

export type ItemInput = Partial<Omit<Item, 'id' | 'updated_at'>> & { name: string };

/** A change suggested by the AI parser; the user reviews it before it is applied. */
export interface Proposal {
  op: 'add' | 'remove' | 'set';
  item_id: string | null;
  name: string;
  quantity: number;
  category?: string | null;
  value?: string | null;
  package?: string | null;
  part_number?: string | null;
  manufacturer?: string | null;
  location?: string | null;
  description?: string | null;
  note?: string | null;
  /** How sure the model is of what this part is. Anything but "high" can lead to an investigation. */
  confidence?: 'high' | 'medium' | 'low';
  /** What it could not determine. */
  unknowns?: string[];
}
