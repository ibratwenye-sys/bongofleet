# Owner Dashboard — Stage 3: Assignments & Payments screens

Build the Assignments and Payments screens in packages/dashboard. This is the final
dashboard stage (3 of 3), building on Stages 1 and 2 (API client with token refresh,
auth context, app shell, and the Modal/ConfirmDialog/StatusBadge components already
created). Turn the existing "Assignments" and "Payments" nav placeholders into real
screens. When this is done, the full daily-operations loop works in the UI.

Build functional-first: reuse the existing components, styling, and API-client patterns.
Use the existing API client (with its automatic 401->refresh handling) for all calls.

## Backend API (already built — do not change the backend)
Check the actual controllers for exact query-param names before wiring filters (note:
list date filters use dateFrom/dateTo, NOT startDate/endDate). Money fields
(targetAmount, amount) come back as strings (Prisma Decimal) — parse for display.

Assignments (OWNER/MANAGER):
- GET    /assignments                    -> list (each includes its motorcycle and rider)
- POST   /assignments                    body {motorcycleId, riderId, assignedDate (YYYY-MM-DD), targetAmount, notes?}
- GET    /assignments/:id
- DELETE /assignments/:id                refuses (400) if the assignment already has payments
- Double-booking a bike or a rider on the same date returns 409 Conflict.

Payments (OWNER/MANAGER):
- GET    /payments                       -> list (filter by riderId, status)
- POST   /payments                       body {dailyAssignmentId, riderId, amount, paymentMethod?}
- PATCH  /payments/:id                   body {status (PENDING|COMPLETED|FAILED), paymentMethod?}  (reconcile)
- GET    /payments/assignment/:assignmentId
- amount more than 50% above the assignment's target returns 400.
- paymentMethod: CASH | MOBILE_MONEY | BANK_TRANSFER.

## Build
1. Assignments screen (existing /assignments route):
   - Table of assignments: date, rider name, motorcycle registration, target amount
     (formatted as TZS), and a small summary of payments so far (e.g. total paid vs
     target, or the latest payment status).
   - "Create assignment" form (modal): a rider dropdown (from GET /riders), a motorcycle
     dropdown (from GET /motorcycles — active bikes), a date picker (defaults to today),
     a target amount, and optional notes. On submit POST /assignments. Show a friendly
     inline error on a 409 (e.g. "That motorcycle is already assigned on this date").
   - Per-row actions: "Record payment" (opens the payment form pre-filled with this
     assignment's id and rider), and Delete (ConfirmDialog; if the backend returns the
     "has payments" 400, show that message rather than crashing).
   - Filter by date.
2. Payments screen (existing /payments route):
   - Table of payments: date, rider name, amount (TZS), method, and status (StatusBadge).
   - Filter by status (PENDING / COMPLETED / FAILED).
   - Reconcile action on PENDING rows: a button that PATCHes the payment to COMPLETED,
     then refreshes. (Optionally also allow marking FAILED.)
   - A "Record payment" entry point here too: let the owner pick an assignment, then
     amount + method -> POST /payments. Surface the 400 overpayment error as a friendly
     inline message ("Amount is more than 50% above the daily target").
3. Shared UX: loading and empty states, brief success confirmations, and readable
   inline errors for both 409 and 400 responses (reuse the array-vs-string message
   handling added in Stage 2).

## Verify before committing (same standard as Stages 1-2)
- `pnpm --filter @bongofleet/dashboard build` and `lint` pass clean.
- With the full stack running (`docker compose up -d --build`), do a live browser smoke
  test (Playwright, screenshots + console/network capture) of the WHOLE loop:
  * create an assignment (pick a rider and a bike, set a target);
  * record a payment against it, then reconcile that payment to COMPLETED;
  * confirm the assignment's payment summary and the Payments table reflect it;
  * confirm the KPI home cards update (today's revenue rises, pending count changes);
  * confirm a double-booked assignment shows a friendly 409 error;
  * confirm an over-target payment shows a friendly 400 error;
  * confirm deleting an assignment that has payments is refused with a clear message;
  * zero console/page errors throughout.
- Note in your summary how you ran the stack for verification.

Show me the diff before pushing to main.
