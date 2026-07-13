# Documents & Guarantors — Stage 2 (Dashboard screens)

Build the dashboard UI for the document + guarantor backend from Stage 1. This makes
the upload buttons, expiry colours, and guarantor section actually appear in the app.
Build functional-first; reuse existing components (Modal, ConfirmDialog, StatusBadge)
and the API client. Read claude/SECURITY_AND_SCALING_REQUIREMENTS.md first.

## Backend already available (Stage 1 — do not change it)
- POST   /documents            multipart: file + {ownerType (RIDER|MOTORCYCLE|GUARANTOR),
                               ownerId, docType (NATIONAL_ID|DRIVERS_LICENSE|LATRA|
                               INSURANCE|REGISTRATION_CARD|GUARANTOR_ID|OTHER),
                               referenceNumber?, expiryDate?}
- GET    /documents?ownerType=&ownerId=   list metadata (each has a computed status:
                               VALID | EXPIRING_SOON | EXPIRED)
- GET    /documents/:id/file   download the file
- DELETE /documents/:id
- GET    /documents/expiring?withinDays=30
- POST /riders/:riderId/guarantors ; GET /riders/:riderId/guarantors ;
  PATCH /guarantors/:id ; DELETE /guarantors/:id

Rebuild the backend container so these endpoints are live before verifying:
`docker compose up -d --build`.

## Build
1. Rider detail view (new — reached by clicking a rider row or a "Manage" action):
   Because documents need the rider's id, they are managed here, after the rider
   exists (not on the initial create-rider modal).
   - Documents section with three slots: National ID, Driver's License, LATRA. For each:
     if a document exists, show its reference number, expiry date, an expiry status
     badge (colour), a View/Download link, and Replace + Delete. If none, show an Upload
     control (file picker + reference number + expiry date -> POST /documents multipart
     with the right docType and ownerType=RIDER).
   - Guarantors section: list the rider's guarantors; "Add guarantor" form (firstName,
     lastName, phone required; relationship?, nationalId?). Each guarantor can have an ID
     uploaded (ownerType=GUARANTOR, ownerId=guarantor id, docType=GUARANTOR_ID), shown
     the same way. Allow edit/remove. If fewer than two guarantors, show a gentle hint
     ("Add at least two guarantors").
2. Motorcycle detail view (new — reached by clicking a bike row): Documents section with
   two slots: Insurance and Registration Card (number + expiry + file, view/replace/
   delete, expiry badge), ownerType=MOTORCYCLE.
3. Expiry badge: reuse/extend StatusBadge — VALID = green, EXPIRING_SOON = amber,
   EXPIRED = red. Drive the colour off the backend's computed status.
4. Dashboard home: add an "Expiring & expired documents" panel from
   GET /documents/expiring?withinDays=30 — each row shows what it is (owner label + doc
   type), the expiry date, and a status colour. Friendly empty state when nothing is due.
5. Shared UX: the file picker accepts images and PDF; surface the backend's 400 as a
   readable message ("Please upload a JPG, PNG, or PDF under 10 MB"); loading + success
   states; reuse the array-vs-string error handling.

## Verify before committing (same standard as prior stages)
- `pnpm --filter @bongofleet/dashboard build` and `lint` pass clean.
- With the full stack rebuilt and running, live browser smoke test (Playwright,
  screenshots + console/network):
  * open a rider, upload a Driver's License with an expiry ~10 days out -> it shows an
    amber "expiring soon" badge; upload one already past -> red "expired";
  * add two guarantors and upload an ID for one of them;
  * open a motorcycle, upload an Insurance document;
  * the Dashboard "expiring" panel lists the expiring/expired items;
  * download an uploaded file back and confirm it opens;
  * a bad file type shows the friendly error, not a crash;
  * zero console/page errors.
- Note how you ran the stack.

Show me the diff before pushing to main.
