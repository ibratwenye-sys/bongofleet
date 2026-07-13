# Owner Dashboard — Stage 2: Fleet & Rider screens

Build the Fleet and Rider management screens in packages/dashboard. This is Stage 2 of
3, building on the Stage 1 foundation (API client with token refresh, auth context,
app shell with nav). Turn the existing "Fleet" and "Riders" nav placeholders into real
screens. Leave "Assignments" and "Payments" as placeholders (that is Stage 3).

Build functional-first: clean, simple tables and forms. Reuse the styling, layout, and
API-client patterns Stage 1 already established. Use the existing API client (with its
automatic 401->refresh handling) for all calls.

## Backend API (already built — do not change the backend)
Motorcycles (OWNER/MANAGER):
- GET    /motorcycles           -> list (excludes deactivated by default)
- POST   /motorcycles           body {registrationNumber (required), make?, model?, year?, gpsDeviceId?, status?}
- GET    /motorcycles/:id
- PATCH  /motorcycles/:id        body: any of the above fields
- DELETE /motorcycles/:id        soft delete (deactivate)
- status enum: ACTIVE | MAINTENANCE | RETIRED
- Duplicate registrationNumber or gpsDeviceId returns 409 Conflict.

Riders (OWNER/MANAGER):
- GET    /riders                 -> list (excludes deactivated by default)
- POST   /riders                 body {firstName, lastName, phone, email, licenseNumber, initialPassword (required), nationalId?, emergencyContact?}
- GET    /riders/:id
- PATCH  /riders/:id             body {firstName?, lastName?, phone?, licenseNumber?, nationalId?, emergencyContact?}
- DELETE /riders/:id             soft delete — ALSO disables the rider's login
- Duplicate email, phone, or licenseNumber returns 409 Conflict.

## Build
1. Fleet screen (the existing /fleet route):
   - A table of motorcycles: registration number, make/model, year, status (as a small
     badge), GPS device id.
   - Filter by status and a search box on registration number (use the list endpoint /
     client-side filter — either is fine).
   - "Add motorcycle" button -> a form (modal or panel): registrationNumber required;
     make, model, year, gpsDeviceId optional; status defaults to ACTIVE.
   - Row actions: Edit (same form, pre-filled, PATCH) and Deactivate (DELETE, with a
     confirm). After any change, refresh the list.
2. Riders screen (the existing /riders route):
   - A table of riders: full name, phone, email, license number, national id.
   - Search box on name or license number.
   - "Add rider" button -> a form: firstName, lastName, phone, email, licenseNumber,
     and initialPassword all required (password min length 8); nationalId and
     emergencyContact optional. Make clear in the form that initialPassword is the
     rider's first login password, which the owner shares with them.
   - Row actions: Edit (PATCH the editable fields) and Deactivate (DELETE, with a
     confirm dialog that WARNS the rider will no longer be able to log in). Refresh the
     list after changes.
3. Shared UX:
   - Client-side validation mirroring the DTOs (required fields, email format, password
     min length), but also surface backend errors: show a readable message on a 409
     Conflict (e.g. "A motorcycle with that registration already exists") and on 400
     validation errors, near the form — do not swallow errors silently.
   - Loading and empty states for both tables.
   - Brief success confirmation after create/edit/deactivate.

## Verify before committing (same standard as Stage 1)
- `pnpm --filter @bongofleet/dashboard build` and `lint` pass clean.
- With the backend and Docker running, do a live browser smoke test (Playwright,
  screenshots + console/network capture):
  * add a motorcycle, see it in the list, edit its status to MAINTENANCE, deactivate it
    and confirm it drops from the list;
  * add a rider, confirm it appears, edit it, then deactivate it and confirm the warning
    shows and the rider can no longer log in;
  * confirm a duplicate registration (and a duplicate rider email) shows a friendly
    error, not a crash.
  * zero console/page errors throughout.
- Note in your summary how you ran the backend for verification.

Show me the diff before pushing to main.
