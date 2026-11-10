import { supabase } from './supabase';
import type { Tool, ToolKind } from './types';

export const KIND_LABEL: Record<ToolKind, string> = {
  multimeter: 'Multimeter',
  oscilloscope: 'Oscilloscope',
  power_supply: 'Bench power supply',
  soldering_iron: 'Soldering iron / station',
  logic_analyzer: 'Logic analyzer',
  function_generator: 'Function generator',
  lcr_meter: 'LCR / component tester',
  '3d_printer': '3D printer',
  other: 'Other',
};

export const KINDS = Object.keys(KIND_LABEL) as ToolKind[];

export const NAME_MAX = 80;
export const NOTES_MAX = 600;

export async function listTools(): Promise<Tool[]> {
  const { data, error } = await supabase.from('tools').select('id,kind,name,notes').order('created_at');
  if (error) throw error;
  return data as Tool[];
}

export interface ToolInput {
  kind: ToolKind;
  name: string;
  notes: string | null;
}

/** Trims, caps lengths, and turns empty notes into null. Returns null when there is no usable name. */
export function cleanTool(input: { kind: ToolKind; name: string; notes: string }): ToolInput | null {
  const name = input.name.trim().slice(0, NAME_MAX);
  if (!name) return null;
  return { kind: input.kind, name, notes: input.notes.trim().slice(0, NOTES_MAX) || null };
}

export async function addTool(input: ToolInput): Promise<Tool> {
  const { data, error } = await supabase.from('tools').insert(input).select('id,kind,name,notes').single();
  if (error) throw error;
  return data as Tool;
}

export async function updateTool(id: string, input: ToolInput): Promise<void> {
  const { error } = await supabase.from('tools').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteTool(id: string): Promise<void> {
  const { error } = await supabase.from('tools').delete().eq('id', id);
  if (error) throw error;
}
