# Roadmap

Ideas that are wanted but not built yet. Newest first within each section.

## Wanted

### Next up

Decide between these (pinouts, the first of the three, is done):

- **Project tracker**: assign parts to a project, see where parts went, keep notes per project. Open question: assigning a part takes it out of stock, and unassigning returns it.
- **Project-ideas chatbot**: suggests what you could build from the parts you have, using the same inventory data the MCP server exposes.

### Pinout follow-ups

- Parts with no datasheet (breakout boards, modules) still have no diagram. A way to enter or paste a pin list by hand would cover them, for example the LCD and the Bluetooth board.
- Package layouts not drawn yet: QFP/QFN/BGA, SOT-23 and other odd shapes. These keep the plain text pin list.
- Tap a pin to see its function; pin alternate functions for microcontrollers.

## Done

- Generated pinout diagrams for dual-row (DIP/SOIC), single-row (headers, modules) and 3-lead (TO-92/TO-220) packages, coloured by pin role.
- Install as a home-screen app (web manifest and icons; no offline mode).
- Undo for quantity changes (toast with Undo after any +/-, typed count or swipe).
- Swipe gestures on list rows (right = +1, left = -1).
- Camera button next to Capture: opens the camera and analyses the photo straight away.
