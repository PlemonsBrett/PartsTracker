-- A pinout the user entered by hand, or that was read from their photos. Separate from the datasheet fact sheet.
-- Shape: { "layout": "dual" | "single" | "three-lead", "pins": [{ "number", "name", "role" }], "source": "manual" | "photo" }
alter table public.items add column pinout jsonb;
