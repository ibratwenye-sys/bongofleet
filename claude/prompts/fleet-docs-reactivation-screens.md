# Fleet document placement, Reactivation UI, Idle logout, Upload UX — Screens

Frontend round in packages/dashboard, building on the backend changes (new document
types + reactivate endpoints + includeInactive listing). Reuse existing components and
the API client. Read claude/SECURITY_AND_SCALING_REQUIREMENTS.md first. Rebuild the
backend first so the new endpoints/enums are live: `docker compose up -d --build`.

## 1. Correct document placement (rider vs fleet)
- Rider detail page: show ONLY these document slots — National ID, Driver's License.
  Remove the LATRA slot from the rider page.
- Motorcycle detail page: show these document slots — Insurance, Registration Card,
  LATRA, Vehicle Inspection, Road Safety Week, and TBS Certificate. All are optional
  (number + expiry + file, with the expiry status badge), same component as riders.
  Label TBS Certificate with a small hint like "(for delivery bikes)".

## 2. Reactivation UI
- On the Fleet page and the Riders page, add a "Show deactivated" toggle/checkbox
  (default off). When on, fetch with includeInactive=true and also show deactivated
  rows, visually marked (e.g. greyed with an "Inactive" tag).
- A deactivated row's actions show "Reactivate" instead of Edit/Deactivate. Reactivate
  calls PATCH /riders/:id/reactivate or /motorcycles/:id/reactivate, then refreshes the
  list. For a rider, mention in a small confirmation that this also restores their login.

## 3. Idle auto-logout (owner web session)
- Add a 30-minute inactivity timeout while logged in. Any user activity (mouse move,
  click, keypress, route change) resets the timer.
- At 29 minutes, show a warning modal: "You'll be logged out soon due to inactivity"
  with a "Stay logged in" button (which resets the timer). At 30 minutes with no
  response, log out: clear tokens and redirect to /login.
- Only runs while authenticated; never on the login page.

## 4. Clearer upload control (from user feedback)
- Replace the tiny native "Choose File" with an obvious, styled control — a clear
  button labelled e.g. "Choose photo or PDF" — that opens the file picker and then shows
  the selected file's name. Drag-and-drop is a nice-to-have, not required.
- Make the "Choose a file to upload." helper read as muted helper text, not a button:
  show it only after an Upload attempt with no file selected, in a smaller, subdued
  style so it can't be mistaken for the clickable control.

## Verify before committing (same standard as prior stages)
- `pnpm --filter @bongofleet/dashboard build` and `lint` pass clean.
- With the full stack rebuilt and running, live browser smoke test (Playwright,
  screenshots + console/network):
  * rider page shows only National ID + Driver's License (no LATRA);
  * motorcycle page shows Insurance, Registration, LATRA, Vehicle Inspection, Road
    Safety Week, TBS Certificate, and a document uploads/replaces successfully there;
  * deactivate a rider, turn on "Show deactivated", Reactivate them, and confirm they
    can log in again; same for a motorcycle;
  * the upload control clearly opens the file picker and shows the chosen filename;
  * idle logout: with a temporarily shortened timer, confirm the warning appears and
    then the session logs out to /login; and confirm activity resets it;
  * zero console/page errors.
- Note how you ran the stack.

Show me the diff before pushing to main.
