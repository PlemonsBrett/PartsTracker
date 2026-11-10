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
}

/** Key specs parsed from a datasheet, so nobody has to read the whole PDF. */
export type Layout = 'dual' | 'single' | 'three-lead';
export type PinRole = 'power' | 'ground' | 'input' | 'output' | 'io' | 'nc' | 'other';
export interface Pin {
  number: number;
  name: string;
  role: PinRole;
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
}
