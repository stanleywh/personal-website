import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var bridge: EventKitBridge
    @EnvironmentObject private var sync: CalendarSyncEngine
    @Environment(\.scenePhase) private var scenePhase
    @State private var email = ""
    @State private var displayName = ""
    @State private var isSignup = false

    private let cream = Color(red: 0.933, green: 0.910, blue: 0.863)
    private let ink = Color(red: 0.184, green: 0.165, blue: 0.141)
    private let accent = Color(red: 0.471, green: 0.388, blue: 0.294)

    var body: some View {
        NavigationStack {
            ZStack {
                cream.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 18) {
                        header
                        if auth.isLoading {
                            ProgressView("Checking your account…").padding(30)
                        } else if auth.isSignedIn {
                            calendarCard
                        } else {
                            signInCard
                        }
                        privacyCard
                    }
                    .padding(22)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                }
            }
            .tint(accent)
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    bridge.refreshPermission()
                    if auth.isSignedIn && bridge.permission == .authorized { Task { await sync.sync() } }
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 6) {
            Text("YOUR STUDY SPACE").font(.caption2.weight(.bold)).tracking(1.6).foregroundStyle(.secondary)
            Text("Revision Tracker").font(.system(size: 38, weight: .medium, design: .rounded)).tracking(-1.8).foregroundStyle(ink)
            Text("Apple Calendar companion").font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 16)
    }

    private var signInCard: some View {
        card {
            Label("Connect your tracker", systemImage: "icloud").font(.title3.weight(.semibold))
            Text("Use the same email as the web tracker. We’ll send a passwordless sign-in link.").font(.subheadline).foregroundStyle(.secondary)
            Picker("Account action", selection: $isSignup) {
                Text("Log in").tag(false)
                Text("Sign up").tag(true)
            }
            .pickerStyle(.segmented)
            if isSignup {
                TextField("Display name", text: $displayName).textContentType(.name)
                    .padding(12).background(.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
            }
            TextField("Email address", text: $email).textContentType(.emailAddress)
                #if os(iOS)
                .textInputAutocapitalization(.never).keyboardType(.emailAddress)
                #endif
                .padding(12).background(.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
            Button(isSignup ? "Email me a sign-up link" : "Email me a login link") {
                Task { await auth.sendMagicLink(to: email, createUser: isSignup, displayName: displayName) }
            }
                .buttonStyle(PrimaryButtonStyle(color: ink)).disabled(email.isEmpty || (isSignup && displayName.isEmpty))
            if let message = auth.message { Text(message).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private var calendarCard: some View {
        card {
            HStack {
                Label("Calendar sync", systemImage: "calendar.badge.checkmark").font(.title3.weight(.semibold))
                Spacer()
                Text(sync.state.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            statusRow("Account", value: auth.email ?? "Signed in", symbol: "person.crop.circle")
            statusRow("Calendar permission", value: bridge.permission.rawValue, symbol: "lock.shield")
            statusRow("Sync boundary", value: "Revision Tracker only", symbol: "calendar")
            if sync.unresolvedConflicts > 0 { statusRow("Conflicts retained", value: String(sync.unresolvedConflicts), symbol: "exclamationmark.triangle") }

            if bridge.permission == .authorized {
                Button { Task { await sync.sync() } } label: { Label("Sync now", systemImage: "arrow.triangle.2.circlepath") }
                    .buttonStyle(PrimaryButtonStyle(color: ink)).disabled(sync.state == .syncing)
            } else {
                Button { Task { if (try? await bridge.requestAccess()) == true { await sync.sync() } } } label: { Label("Enable Apple Calendar", systemImage: "calendar.badge.plus") }
                    .buttonStyle(PrimaryButtonStyle(color: ink))
            }
            Button("Sign out", role: .destructive) { Task { await auth.signOut() } }.font(.footnote.weight(.semibold))
        }
    }

    private var privacyCard: some View {
        card {
            Label("Private by design", systemImage: "hand.raised").font(.headline)
            Text("This app creates one dedicated Revision Tracker calendar per signed-in account. It never synchronizes events from your personal, work, birthday, or subscribed calendars.")
                .font(.caption).foregroundStyle(.secondary).lineSpacing(3)
        }
    }

    private func statusRow(_ title: String, value: String, symbol: String) -> some View {
        HStack(spacing: 11) {
            Image(systemName: symbol).frame(width: 24).foregroundStyle(accent)
            Text(title).font(.subheadline)
            Spacer()
            Text(value).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14, content: content)
            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.48), in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(ink.opacity(0.12)))
    }
}

private struct PrimaryButtonStyle: ButtonStyle {
    let color: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.bold)).foregroundStyle(.white)
            .frame(maxWidth: .infinity).padding(.vertical, 12).background(color.opacity(configuration.isPressed ? 0.78 : 1), in: RoundedRectangle(cornerRadius: 13))
    }
}
