import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var bridge: EventKitBridge
    @EnvironmentObject private var sync: CalendarSyncEngine
    @Environment(\.scenePhase) private var scenePhase
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var displayName = ""
    @State private var isSignup = false
    @State private var isForgotPassword = false

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
                        } else if auth.isRecoveringPassword {
                            recoveryCard
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
                    if auth.isSignedIn && !auth.isRecoveringPassword && bridge.permission == .authorized {
                        Task { await sync.sync() }
                    }
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
            Label(
                isForgotPassword ? "Reset your password" : "Connect your tracker",
                systemImage: isForgotPassword ? "key" : "icloud"
            )
            .font(.title3.weight(.semibold))
            Text(isForgotPassword
                ? "Enter your email address and we’ll send password reset instructions."
                : "Use the same email and password as the web tracker.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if !isForgotPassword {
                Picker("Account action", selection: $isSignup) {
                    Text("Log in").tag(false)
                    Text("Sign up").tag(true)
                }
                .pickerStyle(.segmented)
                .onChange(of: isSignup) { _, _ in
                    password = ""
                    confirmPassword = ""
                    auth.clearMessage()
                }
                if isSignup {
                    TextField("Display name", text: $displayName)
                        .textContentType(.name)
                        .fieldStyle()
                }
            }

            TextField("Email address", text: $email)
                .textContentType(.emailAddress)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                #endif
                .fieldStyle()

            if !isForgotPassword {
                SecureField("Password", text: $password)
                    .textContentType(isSignup ? .newPassword : .password)
                    .fieldStyle()
                if isSignup {
                    SecureField("Confirm password", text: $confirmPassword)
                        .textContentType(.newPassword)
                        .fieldStyle()
                    passwordHint
                }
            }

            if isForgotPassword {
                Button("Send reset instructions") {
                    Task { await auth.requestPasswordReset(email: email) }
                }
                .buttonStyle(PrimaryButtonStyle(color: ink))
                .disabled(email.isEmpty)
                Button("Back to login") {
                    isForgotPassword = false
                    auth.clearMessage()
                }
                .font(.footnote.weight(.semibold))
            } else {
                Button(isSignup ? "Create account" : "Log in") {
                    guard !isSignup || password == confirmPassword else {
                        auth.message = "Passwords do not match."
                        return
                    }
                    Task {
                        if isSignup {
                            await auth.signUp(email: email, password: password, displayName: displayName)
                        } else {
                            await auth.signIn(email: email, password: password)
                        }
                    }
                }
                .buttonStyle(PrimaryButtonStyle(color: ink))
                .disabled(
                    email.isEmpty
                        || password.isEmpty
                        || (isSignup && (displayName.isEmpty || confirmPassword.isEmpty))
                )
                if !isSignup {
                    Button("Forgot password?") {
                        isForgotPassword = true
                        password = ""
                        auth.clearMessage()
                    }
                    .font(.footnote.weight(.semibold))
                    Text("Previously used an email login link? Use Forgot password to set a password.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let message = auth.message {
                Text(message).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var recoveryCard: some View {
        card {
            Label("Choose a new password", systemImage: "key.fill").font(.title3.weight(.semibold))
            Text("This recovery link has authenticated your account. Set a new password to continue.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            SecureField("New password", text: $password)
                .textContentType(.newPassword)
                .fieldStyle()
            SecureField("Confirm new password", text: $confirmPassword)
                .textContentType(.newPassword)
                .fieldStyle()
            passwordHint
            Button("Update password") {
                guard password == confirmPassword else {
                    auth.message = "Passwords do not match."
                    return
                }
                Task { await auth.updatePassword(password) }
            }
            .buttonStyle(PrimaryButtonStyle(color: ink))
            .disabled(password.isEmpty || confirmPassword.isEmpty)
            Button("Sign out", role: .destructive) { Task { await auth.signOut() } }
                .font(.footnote.weight(.semibold))
            if let message = auth.message {
                Text(message).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var passwordHint: some View {
        Text("Use at least 8 characters, including uppercase, lowercase, a number, and a symbol.")
            .font(.caption)
            .foregroundStyle(.secondary)
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
            if sync.unresolvedConflicts > 0 {
                statusRow("Conflicts retained", value: String(sync.unresolvedConflicts), symbol: "exclamationmark.triangle")
            }

            if bridge.permission == .authorized {
                Button {
                    Task { await sync.sync() }
                } label: {
                    Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(PrimaryButtonStyle(color: ink))
                .disabled(sync.state == .syncing)
            } else {
                Button {
                    Task {
                        if (try? await bridge.requestAccess()) == true { await sync.sync() }
                    }
                } label: {
                    Label("Enable Apple Calendar", systemImage: "calendar.badge.plus")
                }
                .buttonStyle(PrimaryButtonStyle(color: ink))
            }
            Button("Sign out", role: .destructive) { Task { await auth.signOut() } }
                .font(.footnote.weight(.semibold))
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

private extension View {
    func fieldStyle() -> some View {
        padding(12).background(.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct PrimaryButtonStyle: ButtonStyle {
    let color: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.bold)).foregroundStyle(.white)
            .frame(maxWidth: .infinity).padding(.vertical, 12)
            .background(color.opacity(configuration.isPressed ? 0.78 : 1), in: RoundedRectangle(cornerRadius: 13))
    }
}
