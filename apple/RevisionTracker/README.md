# Revision Tracker Apple companion

This SwiftUI companion targets iOS 17, iPadOS 17, and macOS 14. It requests EventKit full access only when the user enables sync and restricts every fetch and mutation to the dedicated **Revision Tracker** calendar.

## Prepare on a Mac

1. Install Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen).
2. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` string values to both target Info property lists. The anon key is public; never add the service-role key to an app.
3. Add `revisiontracker://auth/callback` to the Supabase Auth redirect allow-list.
4. Run `xcodegen generate` in this directory, select your development team, and build each target.
5. Exercise calendar permission denial/revocation, recurrence, offline recovery, conflict retention, and identifier changes on real devices before TestFlight distribution.

The macOS target includes the calendar sandbox entitlement. Invitations and Apple-managed attachments remain read-only. Background delivery is best-effort; the app always reconciles when it becomes active.
