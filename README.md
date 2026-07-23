# Stanley's personal website

The revision tracker is a multi-page Vite/TypeScript application with an Apple-inspired calendar, revision mastery table, account-partitioned offline storage, required Supabase accounts, and a SwiftUI/EventKit companion scaffold.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`. Public pages work without environment variables, but account controls and the private tracker fail closed until Supabase is configured.

Run verification with:

```powershell
npm.cmd test
npm.cmd run build
```

## Enable Supabase accounts

1. Create a Supabase project.
2. Apply the SQL files in `supabase/migrations` in filename order through the Supabase CLI.
3. Deploy the `delete-account` Edge Function.
4. Copy `.env.example` to `.env.local` and insert the project URL and public publishable key. The legacy `VITE_SUPABASE_ANON_KEY` name remains a temporary fallback. Never expose the service-role key in the website or native app.
5. Set the Auth Site URL to `https://stanleywh.github.io/personal-website/`.
6. Add these exact Auth redirect URLs:
   - `https://stanleywh.github.io/personal-website/account.html`
   - `http://localhost:5173/account.html`
   - `http://127.0.0.1:5173/account.html`
   - `revisiontracker://auth/callback`
7. Configure the Magic Link email template to use the requested redirect destination, set the OTP expiry to one hour, and configure production SMTP, security notifications, CAPTCHA, and rate limits before enabling public registration.
8. Set the `delete-account` Edge Function secret `ALLOWED_ORIGINS` to a comma-separated list containing `https://stanleywh.github.io,http://localhost:5173,http://127.0.0.1:5173`.

Every user-owned table has row-level security. Events use soft-deletion tombstones; schedule `private.purge_expired_event_tombstones()` daily with Supabase Cron as the function-owning database role for the 30-day recovery policy.

The web app uses passwordless email links. Login disables implicit account creation; sign-up requires a display name and allows account creation. The display name is stored in `public.profiles` and is never used for authorization.

Tracker caches and offline queues use keys scoped by Supabase user ID. The first cloud-empty account on a browser can explicitly import, retain, or discard data from the former shared local keys.

## GitHub Pages

The Pages workflow runs tests and builds the site on pushes to `main`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as repository Actions secrets, then select **GitHub Actions** as the Pages source.

## Apple companion

The source and XcodeGen specification are in `apple/RevisionTracker`. See its README for macOS/Xcode, signing, redirect, EventKit, and TestFlight setup. Native compilation and device testing cannot be performed from this Windows workspace.
