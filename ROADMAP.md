# Roadmap

Ideas that are wanted but not built yet. Newest first within each section.

## Wanted

### Investigation follow-ups

- Photograph a meter or scope reading as the result of a step, and let Claude read the number.
- Per-tool quick reference (which button does what) kept with each tool, so plans can stay specific as the library of tools grows.
- Offer an investigation from the first capture photo for parts that are clearly unknown, before the part is saved.

### Dictation follow-ups

- Live partial words for the on-device engine (transcribe in chunks while you talk).
- Better accuracy for part numbers: a vocabulary of the owner's own parts to bias the model, or an optional cloud transcription service (needs an API key; audio would leave the machine).
- GPU acceleration (WebGPU) where available, so transcription is nearly instant.

### Next up

Decide between these (pinouts, the first of the three, is done):

- **Projects, next**: MCP tools so an agent can read and update projects; mark a part's pins on its pinout from the diagram; export a project (notes, parts, diagram) as Markdown.
- **Project-ideas chatbot**: suggests what you could build from the parts you have, using the same inventory data the MCP server exposes.

### Pinout follow-ups

- A "leads" drawing for wired parts (solar cell, speaker, battery) instead of the chip strip.
- Offer a pinout from the very first capture photo, not only when updating a part.

- Package layouts not drawn yet: QFP/QFN/BGA, SOT-23 and other odd shapes. These keep the plain text pin list.
- Tap a pin to see its function; pin alternate functions for microcontrollers.

## Done

- Projects: notes, a parts list (inventory parts and parts not in the inventory), stock check and shopping list, using parts takes them from the inventory (with put back), and a generated wiring diagram that says where each part goes.
- Desktop mode (table, side panel, keyboard shortcuts, dictation-first capture) and dictation that works in Firefox through an on-device speech model.
- Test equipment profile ("My tools") and an investigation flow for parts capture is unsure about: a test plan written for the owner's own tools, with step progress, safety notes and a hand-off to "Update from photos & notes".
- Enter a pinout by hand (live preview) for parts with no datasheet table, and update a part from extra photos and comments, including a pinout read from the photos. Both are saved on the part, separate from the datasheet.
- Generated pinout diagrams for dual-row (DIP/SOIC), single-row (headers, modules) and 3-lead (TO-92/TO-220) packages, coloured by pin role.
- Install as a home-screen app (web manifest and icons; no offline mode).
- Undo for quantity changes (toast with Undo after any +/-, typed count or swipe).
- Swipe gestures on list rows (right = +1, left = -1).
- Camera button next to Capture: opens the camera and analyses the photo straight away.
