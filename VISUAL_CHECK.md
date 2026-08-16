<!-- markdownlint-disable MD041 -->
# Looking at the dashboard - the literal steps

Stage G6. This exists because the docker-compose backend sat on an image
built once on 2026-07-26 and was never rebuilt - every `docker compose up`
since then silently reused that stale image, so nobody looking at the
running dashboard was actually looking at current code, for several stages.
Follow this every time before eyeballing a UI change; it takes under a
minute when nothing has changed and rebuilds automatically when something
has.

Written assuming you know nothing else about this project. If a command
here fails for a reason not covered below, see `README.md`'s "5-minute
setup" for the one-time prerequisites (pnpm, `.env`).

## 1. Start Postgres, Redis, and the backend - on CURRENT code

From the repo root:

```bash
docker compose up -d --build backend
```

`--build` is the whole point: without it, Docker reuses whatever image
already exists locally, however old. This one command rebuilds the backend
image from the current source and starts it (Postgres/Redis/pgAdmin start
too, or keep running if they already were).

Confirm it actually came up on current code, not a stale image:

```bash
curl http://localhost:3000/health
```

A 200 response confirms the container is answering. If you want to confirm
it specifically has recent routes (e.g. this stage's excusal endpoints),
`docker logs bongofleet-backend | grep excusals` should show them mapped.

## 2. Seed demo data

```bash
pnpm --filter @bongofleet/backend seed
```

Safe to run any time, including repeatedly - it only creates what's
missing. First run creates the owner login and a small ownership-plan
showcase (see below); later runs print "already exists" and do nothing.

## 3. Start the dashboard

In a second terminal, from the repo root:

```bash
pnpm dev:dashboard
```

## 4. Open it

**URL:** <http://localhost:5173>

**Login:**

- Email: `owner@bongofleet.com`
- Password: `Test1234!`

## What you should see

Under **Ownership** in the nav, three plans (plus whatever else has
accumulated in this dev database from earlier manual testing):

| Driver | State | What to look for |
|---|---|---|
| Amina Hassan | Healthy, one day ahead | No colour, "1 day ahead", no missed streak |
| Baraka Mwangi | A few days behind, amber | Amber row, "3 days behind", missed streak of 3 (below this plan's breach threshold of 5) |
| Charles Ndege | Missed streak past breach, red | Red row, missed streak of 7. Open his plan detail page (click through from the list) to see the ledger: one day in the middle of that run is marked **Excused** (green, with a reason and "by Ibrahim Owner"), visibly distinct from the unexcused days around it - the streak still reads as breached even with it excused, because an excusal is transparent to the count, not a subtraction from it. |

All three plans use only obviously-fake sample data - placeholder national
ID (`00000000-00000-00000-00`), placeholder phone numbers, and a placeholder
bank account ("Demo Bank", account `0000000000`). Never real-shaped data.

## If the backend still looks stale

`docker compose up -d --build backend` should always be enough - it forces
a full rebuild. If routes still look missing or old after that, the two
things that have actually gone wrong here before are:

1. **The image genuinely wasn't rebuilt.** `docker images bongofleet-backend`
   shows the image's build time - compare it against `git log -1`'s commit
   time. `docker compose up` *without* `--build` never rebuilds on its own.
2. **The build silently failed to run.** `docker logs bongofleet-backend`
   shows the container's actual startup output - a `MODULE_NOT_FOUND` on
   `dist/main` there means the build's output landed somewhere other than
   `dist/main.js` (this exact failure happened once, from
   `packages/backend/tsconfig.build.json` not excluding a stray top-level
   directory, which shifted TypeScript's inferred `rootDir` - see that
   file's git history if it recurs with a different directory).

## Playwright smoke suite - open the real bundled app, not just eyeball it

Stage H2. Three bugs in a row (the create-plan toggle freeze, a dev-only
infinite loop, and the End/Days left columns reading blank) shipped on a
green build because nothing in CI or this file ever opened the actual
production bundle in a real browser - only the dev server (above) or raw
source. This suite does: it runs `vite build` then `vite preview` and drives
that with a real Chromium instance (`packages/dashboard/e2e/smoke.spec.ts`).

Assumes steps 1 and 2 above (backend up on current code, demo data seeded).
Then, from `packages/dashboard`:

```bash
pnpm test:e2e
```

That's the one command - it builds the dashboard, starts `vite preview` on
port 4173, and runs the suite against it. No second terminal needed; unlike
step 3 above, Playwright manages the preview server itself.

**Local-only gotcha:** the root `.env` (gitignored) sets `CORS_ORIGINS`
explicitly, which overrides `docker-compose.yml`'s default entirely - so
even after `docker-compose.yml` was fixed to allow `http://localhost:4173`
(Stage H2), the backend kept rejecting the preview build's login until
`.env`'s own `CORS_ORIGINS` line was also given that origin and the backend
container recreated (`docker compose up -d backend`) to pick it up. CI never
hits this: it sets env vars directly in the workflow, with no `.env` file to
shadow them.

If it fails, `packages/dashboard/test-results/<test-name>/trace.zip` has a
full trace - `pnpm exec playwright show-trace <path>` opens it.

**Adding a test - read this first.** The suite signs in exactly once per run
(`e2e/auth.setup.ts`) and every test starts from that saved session. That is
not a speed optimisation: the backend allows five login attempts per email
per minute, so back when each test logged in for itself, adding the sixth
test made the sixth and seventh fail with a generic "Something went wrong"
that looks nothing like a rate limit. Refresh tokens are also single-use and
rotate, so each test hands the freshly-issued one to the next via an
`afterEach` (see the comment there). Write new tests to start already signed
in; do not add a login step, and do not raise the rate limit to make room.
