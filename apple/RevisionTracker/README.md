# Revision Tracker Apple companion

This SwiftUI companion targets iOS 17, iPadOS 17, and macOS 14. It requests EventKit full access only when the user enables sync and restricts every fetch and mutation to the dedicated **Revision Tracker** calendar.

## Prepare on a Mac

1. Install Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen).
2. Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` string values to both target Info property lists. The publishable key is public; never add the service-role key to an app. The old `SUPABASE_ANON_KEY` name is accepted only as a compatibility fallback.
3. Add `revisiontracker://auth/callback` to the Supabase Auth redirect allow-list. Keep Email signup and email confirmation enabled, and match the web password policy: at least 8 characters with lowercase, uppercase, a digit, and a symbol.
4. Run `xcodegen generate` in this directory, select your development team, and build each target.
5. Run the `RevisionTrackerTests` unit-test target. Exercise signup confirmation, password login, recovery deep links, Keychain restoration, calendar permission denial/revocation, recurrence, offline recovery, conflict retention, and identifier changes on real devices before TestFlight distribution.

The macOS target includes the calendar sandbox entitlement. Invitations and Apple-managed attachments remain read-only. Background delivery is best-effort; the app always reconciles when it becomes active.

Login and sign-up use Supabase email-and-password Auth. Sign-up requires a display name and email confirmation; login calls the password token endpoint and sends no email. **Forgot password** sends a recovery link to the app deep link, and calendar content remains blocked until the authenticated recovery session sets a new password.

Existing passwordless users should use **Forgot password** once. Recovery updates the same Supabase Auth user, preserving the user ID, profile, revision data, RLS ownership, and per-user EventKit calendar identifier. EventKit identifiers remain scoped to the authenticated Supabase user so switching accounts never reuses another account's dedicated calendar.
