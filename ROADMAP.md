# Roadmap

Ideas that are wanted but not built yet. Newest first within each section.

## Wanted

### Generated pinout diagrams (ICs, microcontrollers)

Show a drawn pinout in a part's details instead of the plain "1 GAIN, 2 -INPUT, …" text, so it is easy to read at a glance.

- Render an SVG of the package: chip body with pin 1 marked, pins numbered around it in the correct order, each labelled with its name. Colour or icon pins by role (power, ground, input, output, other).
- Start with the packages that matter most: DIP-N, SOIC/SOP-N, TO-92 and TO-220 (3-pin). Later: QFP/QFN, SOT-23.
- Data: have `find-datasheet` return structured pins (`{ number, name, role }`) alongside the existing `pinout` string, stored in `fact_sheet`. For parts already looked up, fall back to parsing the existing `pinout` text, or re-run the lookup.
- Use the part's `package` field to pick the layout; if the package is unknown or unsupported, keep showing the text list.
- Pinouts are easy to get subtly wrong, so show the same "parsed from the datasheet, verify against the source" note, and link to the source page.
- Possible extras: tap a pin to see its function; expose the structured pins through the MCP `get_datasheet` tool so agents get them too.

## Done

- Install as a home-screen app (web manifest and icons; no offline mode).
- Undo for quantity changes (toast with Undo after any +/-, typed count or swipe).
- Swipe gestures on list rows (right = +1, left = -1).
- Camera button next to Capture: opens the camera and analyses the photo straight away.
