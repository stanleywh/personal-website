import SwiftUI

@main
struct RevisionTrackerApp: App {
    @StateObject private var auth: AuthService
    @StateObject private var bridge: EventKitBridge
    @StateObject private var sync: CalendarSyncEngine

    init() {
        let auth = AuthService()
        let bridge = EventKitBridge()
        _auth = StateObject(wrappedValue: auth)
        _bridge = StateObject(wrappedValue: bridge)
        _sync = StateObject(wrappedValue: CalendarSyncEngine(auth: auth, bridge: bridge, api: SupabaseAPI(auth: auth)))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
                .environmentObject(bridge)
                .environmentObject(sync)
                .onOpenURL { auth.handleCallback($0) }
                .task {
                    sync.startListening()
                    if auth.isSignedIn && bridge.permission == .authorized { await sync.sync() }
                }
        }
    }
}
