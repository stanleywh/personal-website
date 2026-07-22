import Foundation

@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var isSignedIn = false
    @Published private(set) var email: String?
    @Published var message: String?

    private let baseURL: URL
    private let anonKey: String
    private(set) var accessToken: String?
    private(set) var refreshToken: String?

    init() {
        let url = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String ?? "https://YOUR_PROJECT.supabase.co"
        baseURL = URL(string: url)!
        anonKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String ?? "YOUR_PUBLIC_ANON_KEY"
        accessToken = KeychainStore.get("accessToken")
        refreshToken = KeychainStore.get("refreshToken")
        email = KeychainStore.get("email")
        isSignedIn = accessToken != nil
    }

    var isConfigured: Bool { !baseURL.absoluteString.contains("YOUR_PROJECT") && !anonKey.contains("YOUR_PUBLIC") }

    var userId: String? {
        guard let accessToken else { return nil }
        let parts = accessToken.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded), let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return payload["sub"] as? String
    }

    func sendMagicLink(to email: String) async {
        guard isConfigured else { message = "Add SUPABASE_URL and SUPABASE_ANON_KEY to the target Info settings first."; return }
        do {
            var components = URLComponents(url: baseURL.appending(path: "auth/v1/otp"), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "redirect_to", value: "revisiontracker://auth/callback")]
            var request = URLRequest(url: components.url!)
            request.httpMethod = "POST"
            request.setValue(anonKey, forHTTPHeaderField: "apikey")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "create_user": true])
            let (_, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            self.email = email
            try KeychainStore.set(email, for: "email")
            message = "Check your email on this device for the sign-in link."
        } catch {
            message = "Couldn’t send the link: \(error.localizedDescription)"
        }
    }

    func handleCallback(_ url: URL) {
        let fragment = URLComponents(string: url.absoluteString.replacingOccurrences(of: "#", with: "?"))
        let values = Dictionary(uniqueKeysWithValues: (fragment?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        guard let access = values["access_token"], let refresh = values["refresh_token"] else {
            message = values["error_description"] ?? "The sign-in link was invalid or expired."
            return
        }
        do {
            try KeychainStore.set(access, for: "accessToken")
            try KeychainStore.set(refresh, for: "refreshToken")
            accessToken = access
            refreshToken = refresh
            isSignedIn = true
            message = nil
        } catch {
            message = "The secure session could not be stored."
        }
    }

    func validAccessToken() async throws -> String {
        guard let accessToken else { throw URLError(.userAuthenticationRequired) }
        if let expiry = tokenExpiry(accessToken), expiry.timeIntervalSinceNow < 90 { return try await refreshSession() }
        return accessToken
    }

    private func tokenExpiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded), let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let expiry = payload["exp"] as? TimeInterval else { return nil }
        return Date(timeIntervalSince1970: expiry)
    }

    private func refreshSession() async throws -> String {
        guard let refreshToken else { throw URLError(.userAuthenticationRequired) }
        var components = URLComponents(url: baseURL.appending(path: "auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = payload["access_token"] as? String,
              let refresh = payload["refresh_token"] as? String else { throw URLError(.userAuthenticationRequired) }
        try KeychainStore.set(access, for: "accessToken")
        try KeychainStore.set(refresh, for: "refreshToken")
        accessToken = access
        self.refreshToken = refresh
        return access
    }

    func signOut() {
        KeychainStore.removeAll()
        accessToken = nil
        refreshToken = nil
        email = nil
        isSignedIn = false
    }
}
