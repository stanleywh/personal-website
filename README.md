# Stanley's personal website

The revision tracker is a multi-page Vite/TypeScript application with an Apple-inspired calendar, revision mastery table, local-first storage, optional Supabase accounts, and a SwiftUI/EventKit companion scaffold.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/tracker.html`. Without environment variables, the tracker intentionally runs in local mode and stores data in the browser.

Run verification with:

```powershell
npm.cmd test
npm.cmd run build
```

## Enable Supabase cloud accounts

1. Create a Supabase project.
2. Apply `supabase/migrations/202607220001_revision_tracker.sql` through the Supabase CLI or SQL editor.
3. Deploy the `delete-account` Edge Function.
4. Copy `.env.example` to `.env.local` and insert the project URL and public anon key. Never expose the service-role key in the website or native app.
5. Add local and production `tracker.html` URLs to the Supabase Auth redirect allow-list.
6. Configure email templates, SMTP, CAPTCHA, and rate limits before enabling public registration.

Every user-owned table has row-level security. Events use soft-deletion tombstones; schedule `public.purge_expired_event_tombstones()` daily with Supabase Cron for the 30-day recovery policy.

## GitHub Pages

The Pages workflow runs tests and builds the site on pushes to `main`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as repository Actions secrets, then select **GitHub Actions** as the Pages source.

## Apple companion

The source and XcodeGen specification are in `apple/RevisionTracker`. See its README for macOS/Xcode, signing, redirect, EventKit, and TestFlight setup. Native compilation and device testing cannot be performed from this Windows workspace.
