# BNO / UK Residence Tracker handover

The BNO feature is a native `/bno/` page in the existing Vite multipage website. It uses the existing Supabase account, tracker shell, shared visual tokens, native dialogs, FullCalendar, Luxon and Vitest. There are **no new website package dependencies**. No personal dates or travel records are seeded. All example journeys are test fixtures only.

## Included

- Overview: current recorded location, current/worst rolling BNO absence totals, citizenship totals, dual counting, coverage and data-review notices.
- Flights with keyboard-accessible airport autocomplete, timezone-aware inputs, complete timestamps, optional booking details, edit/delete, and automatically derived trips.
- Manual absences, including open trips; searchable/sortable trip and raw flight history with source, year and destination filters.
- Month/year calendars, annual timeline, accessible rolling chart with a daily keyboard slider, rules and official source links.
- Unsaved simulation, independently calculated official/conservative latest-return dates, saved plans, atomic plan conversion, and links from fulfilled plans to actual flights.
- Settings for all personal dates, coverage declaration, initial location, planning preference and warning percentages.
- Owner-scoped cloud storage, RLS, version-checked edits, account-separated read-only offline cache, and cleanup on logout/account changes/deletion.

## Supabase setup required before deployment

Production was not changed. Apply `supabase/migrations/20260926154027_bno_residence_tracker.sql` after the existing migrations using your normal Supabase migration workflow. It creates four RLS-protected tables, private validation/version triggers, and two security-invoker RPC functions. It does not alter existing tracker tables or insert travel data.

Add these URLs to the existing Supabase Auth redirect allowlist, retaining existing entries:

- `https://dashboard.prerelease.uk/account/?mode=callback&next=bno`
- `https://dashboard.prerelease.uk/account/?mode=recovery&next=bno`
- `http://localhost:5173/account/?mode=callback&next=bno`
- `http://localhost:5173/account/?mode=recovery&next=bno`
- `http://127.0.0.1:5173/account/?mode=callback&next=bno`
- `http://127.0.0.1:5173/account/?mode=recovery&next=bno`

No new environment variables or service-role keys are needed. The existing Pages deployment will include `/bno/` on the next explicitly requested deployment. No commit, push or deployment was performed.

After applying the migration, test signup/recovery return navigation, two real Supabase users, cross-device edits, and account deletion in a disposable account. Local database checks use PostgreSQL via PGlite with an isolated `auth.uid()` stand-in; they do not replace live Supabase Auth integration checks.

## Calculation conventions

Flights remain the source of truth. UK-to-foreign departure opens a trip, foreign legs extend it, and arrival in the UK closes it. Manual trips enter the same calculation engine. Duplicate/overlapping dates are unioned rather than double-counted. Suspicious records are preserved and surfaced for correction. Problems suppress definitive safe labels and latest-return results.

A completed trip's **official** dates run from departure + 1 day through return − 1 day. **Conservative** dates include both endpoints. Same-day travel counts 0 / 1. For 2 July–11 September 2026 the result is 70 / 72. Ongoing official totals include completed UK days; today is separately provisional and included conservatively. Flights currently in transit retain an open absence until their return actually arrives.

UK boundary dates use `Europe/London`; stored flight times use UTC plus the entered airport timezone and metadata snapshot. Day arithmetic is on date-only UTC calendar coordinates, not local browser timestamps or 24-hour duration division. DST gaps are rejected and repeated local times require an explicit UTC offset.

For every day E from the configured BNO start to today (or actual ILR), the engine evaluates the inclusive calendar window **E minus twelve months plus one day → E**. Difference arrays create official/conservative daily masks; prefix sums count each window. All daily windows are scanned, with earliest ties selected. The two maxima are independent: the conservative count in the worst *official* window can differ from the independently worst conservative window. No mutable totals are stored. Runtime is linear in residence days after interval creation; periods beyond 200 years are rejected.

Latest-return search tries successive return dates, recalculating the complete rolling history for each candidate. A continuous absence must exceed the default limit within 180 days plus the two travel boundaries, unless monitoring ends at ILR. The first failing candidate proves the previous date is the boundary. Saved-plan conflicts, existing breaches, unknown coverage or ILR cutoffs produce explicit messages. The calculation runs in a web worker and does not block UI rendering.

Citizenship primary windows follow the caseworker convention, starting the day after the five-year/twelve-month anniversary. The exact-anniversary presence check and alternative totals are also visible because public guidance describes a different boundary. Calendar month subtraction clamps to the final valid date; leap-day cases are flagged. Future citizenship figures are projections from recorded information, not eligibility decisions.

## Data and operational behaviour

The initial history-complete-from date and location are user declarations, not evidence inferred from a visa date. Earlier/unestablished periods remain unknown. If initial location is abroad, record the initial absence explicitly. Missing history and inconsistencies never silently become UK presence.

Actual ILR ends BNO monitoring but not citizenship tracking. Future travel belongs in Planning and never automatically becomes actual history. Conversion is a deliberate atomic database action; repeated conversion returns the same manual record. Deleting a flight-derived trip deletes its listed source flights in one transaction with version checks. Deleting a plan does not delete its linked actual history.

Offline use permits reading the current account's cache and unsaved planning. Mutations require connectivity; failed forms stay open. A planning-mode change offline is session-only until saved online. Cache failures do not affect successful cloud writes. Other-device changes are picked up on refresh, reconnect and focus when no editable form would be discarded; there is no realtime subscription or offline write queue.

## Airport data

`public/bno/airports.json` contains 8,801 airport entries (roughly 1.6 MB uncompressed), loaded only when airport search is first used. OurAirports supplies airport/country metadata; OpenFlights supplies IANA timezone enrichment. 3,471 entries lack an unambiguous timezone and require explicit input. This avoids guessing offsets from coordinates or the user's device.

Pinned source URLs and SHA-256 checksums are in `public/bno/sources.json`. Attribution and licence terms are in `public/bno/NOTICE.md`; the combined airport database is ODbL 1.0. Rebuild with `python3 scripts/bno/generate-airports.py` (network required). Updating the index does not rewrite stored flight snapshots.

## Validation and repeatable QA

Run the ordinary project checks with Node 22 (the CI runtime) or the bundled Node 24 runtime:

```sh
npm test
npm run typecheck
npm run build
npm run verify:dist
GITHUB_ACTIONS=true npm run build
npm run verify:dist
```

The host's Node 26 global-storage behaviour is incompatible with the current Vitest/jsdom combination: existing tests fail at `localStorage.clear()` before assertions. The entire suite passes on Node 24. No production dependencies or unrelated test configuration were changed to work around that host issue.

Optional isolated database/browser QA tools are **not website dependencies**. Install them in a temporary tools directory if needed:

```sh
npm install --prefix /tmp/bno-qa --no-save @electric-sql/pglite playwright
BNO_PGLITE_MODULE=/tmp/bno-qa/node_modules/@electric-sql/pglite/dist/index.js node scripts/bno/test-database.mjs
```

The database script tests migration execution, owner CRUD, foreign-user denial, ownership reassignment, optimistic version checks, conversion idempotency, transactional deletion rollback, anonymous access denial and account deletion cascades. It creates only an in-memory PostgreSQL database.

For browser QA, start Vite with dummy settings in a separate terminal:

```sh
VITE_SUPABASE_URL=https://bno-test.invalid VITE_SUPABASE_PUBLISHABLE_KEY=bno-public-test-key npm run dev -- --host 127.0.0.1 --port 5177
BNO_PLAYWRIGHT_MODULE=/tmp/bno-qa/node_modules/playwright/index.mjs BNO_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/bno/browser-smoke.mjs
```

The browser script intercepts every dummy Supabase request; it never sends its test fixtures to a real account. It tests empty/setup states, keyboard airport selection, failed-save retention, manual flight entry and 70/72 totals, all six sections at 1440/1280/834/390px, visible month cells, simulation and the worker, larger text, modal focus/Escape, offline reading and logout cache deletion. Screenshots go to `/tmp/bno-browser-qa` by default. An installed Playwright browser can be used by omitting `BNO_CHROME_PATH`.

## Limits and remaining manual checks

- This covers absence/residence information, not all settlement or citizenship eligibility requirements, discretionary exceptions, legal advice, or proof of recorded journeys.
- Crown Dependency travel is flagged rather than automatically exempted. Leap-day citizenship boundaries and the conflicting published presence-date descriptions require verification against current official guidance.
- Browser automation used desktop Chrome with responsive viewports. Test physical iPhone/iPad Safari, touch autocomplete, browser zoom and screen-reader operation on your devices before relying on the feature.
- Live Supabase authentication, real cross-device synchronisation, email callback redirects and production deployment remain manual post-migration checks.

## Files

Added: `bno/index.html`; `src/bno/{types,rules,dates,engine,store,airports,render,main,entry,planner-worker}.ts`; `src/bno/bno.css`; the BNO migration; `public/bno/{airports.json,sources.json,NOTICE.md}`; `scripts/bno/{generate-airports.py,test-database.mjs,browser-smoke.mjs}`; `tests/bno-{engine,storage,airports}.test.ts`; this handover.

Modified: homepage `index.html`, `vite.config.ts`, `scripts/verify-dist.mjs`, `src/auth/navigation.ts`, `src/auth/session.ts`, and `README.md`. Existing Revision Tracker calculations and records are unchanged.
