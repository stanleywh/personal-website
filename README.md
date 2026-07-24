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
5. Set the Auth Site URL to `https://dashboard.prerelease.uk/`.
6. Add these exact Auth redirect URLs:
   - `https://dashboard.prerelease.uk/account/`
   - `https://dashboard.prerelease.uk/account/?mode=callback&next=home`
   - `https://dashboard.prerelease.uk/account/?mode=callback&next=tracker`
   - `https://dashboard.prerelease.uk/account/?mode=recovery&next=home`
   - `https://dashboard.prerelease.uk/account/?mode=recovery&next=tracker`
   - `http://localhost:5173/account/`
   - `http://localhost:5173/account/?mode=callback&next=home`
   - `http://localhost:5173/account/?mode=callback&next=tracker`
   - `http://localhost:5173/account/?mode=recovery&next=home`
   - `http://localhost:5173/account/?mode=recovery&next=tracker`
   - `http://127.0.0.1:5173/account/`
   - `http://127.0.0.1:5173/account/?mode=callback&next=home`
   - `http://127.0.0.1:5173/account/?mode=callback&next=tracker`
   - `http://127.0.0.1:5173/account/?mode=recovery&next=home`
   - `http://127.0.0.1:5173/account/?mode=recovery&next=tracker`
   - `revisiontracker://auth/callback`
7. In **Authentication → Providers → Email**, keep Email and signup enabled, keep **Confirm email** enabled, set the minimum password length to 8, and require lowercase, uppercase, digits, and symbols. Keep **Require current password to change password** disabled so existing passwordless users can complete an authenticated recovery.
8. In **Authentication → Email Templates**, keep the Confirm signup and Reset password templates on `{{ .ConfirmationURL }}` so each requested redirect is retained. The Confirm signup body must contain a real HTML anchor, for example `<a href="{{ .ConfirmationURL }}">Confirm email address</a>`. The Magic Link template is unused. Enable the password-changed security notification and verify production SMTP delivers confirmation and recovery messages. If the project plan does not allow custom templates, use Supabase's defaults.
9. Retain the one-hour token expiry and email rate limits, and configure CAPTCHA and other production abuse controls before enabling public registration.
10. Set the `delete-account` Edge Function secret `ALLOWED_ORIGINS` to `https://dashboard.prerelease.uk,http://localhost:5173,http://127.0.0.1:5173`, then redeploy only that function.

Every user-owned table has row-level security. Events use soft-deletion tombstones; schedule `private.purge_expired_event_tombstones()` daily with Supabase Cron as the function-owning database role for the 30-day recovery policy.

The web app uses email-and-password authentication. Sign-up requires a display name and confirmation email; normal login never sends an email. Password recovery establishes an authenticated recovery session before accepting a new password, then signs out that temporary session and waits for the user to return to login explicitly. Existing passwordless users should use **Forgot password** once to add a password to their existing Supabase user. This preserves their user ID, profile, revision records, and ownership relationships without recreating or relinking any data.

The display name is stored in `public.profiles` and is never used for authorization. Authentication changes do not require changes to RLS policies, grants, table ownership, profile triggers, or the account-deletion function.

Tracker caches and offline queues use keys scoped by Supabase user ID. The first cloud-empty account on a browser can explicitly import, retain, or discard data from the former shared local keys.

### Confirmation email troubleshooting

The safe hosted **Confirm signup** template structure is:

```html
<h2>Confirm your email address</h2>
<p>Follow the link below to finish creating your account.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>
<p>If you did not create this account, you can ignore this email.</p>
```

If Gmail displays the label without a clickable link, inspect the affected message with **Show original** before changing SMTP. Confirm that a `text/html` MIME part contains the anchor and a Supabase `/auth/v1/verify` URL, then test the same message after choosing **Report not spam**. Check SPF, DKIM, DMARC, Supabase Auth generation logs, and Resend delivery status separately. Redact recipient addresses and token values; never share SMTP passwords, API keys, access tokens, or live confirmation URLs. If the raw anchor is valid, treat Spam placement as a deliverability problem rather than changing the frontend signup flow.

## GitHub Pages

The Pages workflow runs tests, builds the site, and verifies its static directory routes on pushes to `main`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as repository Actions secrets, then select **GitHub Actions** as the Pages source.

The production routes are:

- `https://dashboard.prerelease.uk/`
- `https://dashboard.prerelease.uk/tracker/`
- `https://dashboard.prerelease.uk/about/`
- `https://dashboard.prerelease.uk/account/`

To configure the custom domain:

1. In personal GitHub **Settings → Pages**, verify `prerelease.uk` with the TXT record GitHub supplies and retain that record.
2. In this repository's **Settings → Pages**, set the custom domain to `dashboard.prerelease.uk`.
3. In Cloudflare, create a DNS-only `CNAME` named `dashboard` pointing to `stanleywh.github.io`. Do not include the repository name and do not create section subdomains.
4. After DNS and GitHub certificate provisioning complete, enable **Enforce HTTPS** in GitHub Pages.

The Actions deployment does not need a repository `CNAME` file. Before Supabase cutover, add the new redirect URLs above. After the custom domain has worked for at least the one-hour token-expiry window, remove all former `stanleywh.github.io/personal-website` redirects. Keep both Confirm signup and Reset password email templates on `{{ .ConfirmationURL }}` and remove any hard-coded former domain.

Run the deployment checks locally with:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run verify:dist
$env:GITHUB_ACTIONS = "true"
npm.cmd run build
npm.cmd run verify:dist
Remove-Item Env:GITHUB_ACTIONS
```

### Stale local navigation

Finance and Projects are intentionally absent. `npm run dev` serves the current source, while `npm run preview` serves the last `dist` build. To confirm that a local view is current:

```powershell
git status --short --branch
git branch --show-current
git log -1 --oneline --decorate
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
```

An up-to-date checkout prints `0 0` on the final command. Stop any old Vite process with `Ctrl+C`, restart with `npm.cmd run dev -- --host 127.0.0.1`, and use `Ctrl+F5` at `http://127.0.0.1:5173/`. If necessary, restart once with `npm.cmd run dev -- --force --host 127.0.0.1`. Build and run `npm.cmd run verify:dist` before using preview; the verifier rejects Finance or Projects output.

## Apple companion

The source and XcodeGen specification are in `apple/RevisionTracker`. See its README for macOS/Xcode, signing, redirect, EventKit, and TestFlight setup. Native compilation and device testing cannot be performed from this Windows workspace.
