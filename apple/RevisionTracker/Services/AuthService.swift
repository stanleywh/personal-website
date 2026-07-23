import Combine
import Foundation

protocol AuthHTTPClient {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionAuthHTTPClient: AuthHTTPClient {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, response)
    }
}

protocol AuthSessionStoring {
    func get(_ key: String) -> String?
    func set(_ value: String, for key: String) throws
    func removeAll()
}

struct KeychainAuthSessionStore: AuthSessionStoring {
    func get(_ key: String) -> String? { KeychainStore.get(key) }
    func set(_ value: String, for key: String) throws { try KeychainStore.set(value, for: key) }
    func removeAll() { KeychainStore.removeAll() }
}

@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var isLoading = true
    @Published private(set) var isSignedIn = false
    @Published private(set) var isRecoveringPassword = false
    @Published private(set) var email: String?
    @Published var message: String?

    private let baseURL: URL
    private let anonKey: String
    private let http: AuthHTTPClient
    private let store: AuthSessionStoring
    private(set) var accessToken: String?
    private(set) var refreshToken: String?

    init(
        baseURL: URL? = nil,
        anonKey: String? = nil,
        http: AuthHTTPClient = URLSessionAuthHTTPClient(),
        store: AuthSessionStoring = KeychainAuthSessionStore()
    ) {
        let configuredURL = baseURL?.absoluteString
            ?? Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String
            ?? "https://YOUR_PROJECT.supabase.co"
        self.baseURL = URL(string: configuredURL)!
        self.anonKey = anonKey
            ?? Bundle.main.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String
            ?? "YOUR_PUBLIC_KEY"
        self.http = http
        self.store = store
        accessToken = store.get("accessToken")
        refreshToken = store.get("refreshToken")
        email = store.get("email")
        isRecoveringPassword = store.get("recoveryPending") == "true"
    }

    var isConfigured: Bool {
        !baseURL.absoluteString.contains("YOUR_PROJECT") && !anonKey.contains("YOUR_PUBLIC")
    }

    var userId: String? {
        guard let accessToken else { return nil }
        let parts = accessToken.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var encoded = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard
            let data = Data(base64Encoded: encoded),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return payload["sub"] as? String
    }

    func clearMessage() {
        message = nil
    }

    func bootstrap() async {
        guard accessToken != nil else {
            isLoading = false
            return
        }
        do {
            let token = try await validAccessToken()
            var request = request(path: "auth/v1/user")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await http.send(request)
            guard response.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
            isSignedIn = true
        } catch {
            clearLocalSession()
            message = "Your session expired. Sign in with your password."
        }
        isLoading = false
    }

    func signUp(email: String, password: String, displayName: String) async {
        guard requireConfiguration() else { return }
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...50).contains(trimmedName.count) else {
            message = "Choose a display name between 1 and 50 characters."
            return
        }
        guard validatePassword(password) else { return }

        do {
            var request = try redirectRequest(path: "auth/v1/signup")
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": trimmedEmail,
                "password": password,
                "data": [
                    "display_name": trimmedName,
                    "timezone": TimeZone.current.identifier,
                    "locale": Locale.current.identifier
                ]
            ])
            let (data, response) = try await http.send(request)
            guard (200..<300).contains(response.statusCode) else { throw responseError(data) }
            self.email = trimmedEmail
            try store.set(trimmedEmail, for: "email")
            message = "Check your inbox to confirm your email address before signing in."
        } catch {
            message = error.localizedDescription
        }
    }

    func signIn(email: String, password: String) async {
        guard requireConfiguration() else { return }
        do {
            var components = URLComponents(
                url: baseURL.appending(path: "auth/v1/token"),
                resolvingAgainstBaseURL: false
            )!
            components.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
            var request = request(url: components.url!)
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
                "password": password
            ])
            let (data, response) = try await http.send(request)
            guard (200..<300).contains(response.statusCode) else { throw responseError(data) }
            try persistSession(from: data)
            isSignedIn = true
            isLoading = false
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    func requestPasswordReset(email: String) async {
        guard requireConfiguration() else { return }
        do {
            var request = try redirectRequest(path: "auth/v1/recover")
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": email.trimmingCharacters(in: .whitespacesAndNewlines)
            ])
            let (_, response) = try await http.send(request)
            guard (200..<300).contains(response.statusCode) else { throw URLError(.badServerResponse) }
            message = "If an account exists for that email, password reset instructions are on the way."
        } catch {
            message = "Password reset could not be requested right now. Try again later."
        }
    }

    func updatePassword(_ password: String) async {
        guard isRecoveringPassword, accessToken != nil else {
            message = "Open a current password reset link before choosing a new password."
            return
        }
        guard validatePassword(password) else { return }
        do {
            let token = try await validAccessToken()
            var request = request(path: "auth/v1/user")
            request.httpMethod = "PUT"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["password": password])
            let (data, response) = try await http.send(request)
            guard (200..<300).contains(response.statusCode) else { throw responseError(data) }
            try store.set("false", for: "recoveryPending")
            isRecoveringPassword = false
            isSignedIn = true
            message = "Password updated."
        } catch {
            message = error.localizedDescription
        }
    }

    func handleCallback(_ url: URL) {
        let fragmentURL = url.absoluteString.replacingOccurrences(of: "#", with: "?")
        let components = URLComponents(string: fragmentURL)
        var values: [String: String] = [:]
        for item in components?.queryItems ?? [] where values[item.name] == nil {
            values[item.name] = item.value ?? ""
        }
        guard let access = values["access_token"], let refresh = values["refresh_token"] else {
            message = values["error_description"] ?? "The authentication link was invalid or expired."
            return
        }
        do {
            try store.set(access, for: "accessToken")
            try store.set(refresh, for: "refreshToken")
            if values["type"] == "recovery" {
                try store.set("true", for: "recoveryPending")
                isRecoveringPassword = true
            }
            accessToken = access
            refreshToken = refresh
            isSignedIn = true
            isLoading = false
            message = nil
        } catch {
            message = "The secure session could not be stored."
        }
    }

    func validAccessToken() async throws -> String {
        guard let accessToken else { throw URLError(.userAuthenticationRequired) }
        if let expiry = tokenExpiry(accessToken), expiry.timeIntervalSinceNow < 90 {
            return try await refreshSession()
        }
        return accessToken
    }

    func signOut() async {
        if let accessToken {
            var components = URLComponents(
                url: baseURL.appending(path: "auth/v1/logout"),
                resolvingAgainstBaseURL: false
            )!
            components.queryItems = [URLQueryItem(name: "scope", value: "local")]
            var request = request(url: components.url!)
            request.httpMethod = "POST"
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
            _ = try? await http.send(request)
        }
        clearLocalSession()
        message = nil
    }

    private func requireConfiguration() -> Bool {
        guard isConfigured else {
            message = "Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to the target Info settings first."
            return false
        }
        return true
    }

    private func validatePassword(_ password: String) -> Bool {
        guard let validationMessage = PasswordPolicy.validationMessage(for: password) else { return true }
        message = validationMessage
        return false
    }

    private func request(path: String) -> URLRequest {
        request(url: baseURL.appending(path: path))
    }

    private func request(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func redirectRequest(path: String) throws -> URLRequest {
        guard var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        ) else { throw URLError(.badURL) }
        components.queryItems = [
            URLQueryItem(name: "redirect_to", value: "revisiontracker://auth/callback")
        ]
        guard let url = components.url else { throw URLError(.badURL) }
        return request(url: url)
    }

    private func persistSession(from data: Data) throws {
        guard
            let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let access = payload["access_token"] as? String,
            let refresh = payload["refresh_token"] as? String
        else { throw URLError(.cannotParseResponse) }
        let user = payload["user"] as? [String: Any]
        let responseEmail = user?["email"] as? String
        try store.set(access, for: "accessToken")
        try store.set(refresh, for: "refreshToken")
        if let responseEmail {
            try store.set(responseEmail, for: "email")
            email = responseEmail
        }
        accessToken = access
        refreshToken = refresh
    }

    private func tokenExpiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var encoded = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard
            let data = Data(base64Encoded: encoded),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let expiry = payload["exp"] as? TimeInterval
        else { return nil }
        return Date(timeIntervalSince1970: expiry)
    }

    private func refreshSession() async throws -> String {
        guard let refreshToken else { throw URLError(.userAuthenticationRequired) }
        var components = URLComponents(
            url: baseURL.appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        var request = request(url: components.url!)
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])
        let (data, response) = try await http.send(request)
        guard (200..<300).contains(response.statusCode) else {
            throw URLError(.userAuthenticationRequired)
        }
        try persistSession(from: data)
        guard let accessToken else { throw URLError(.userAuthenticationRequired) }
        return accessToken
    }

    private func responseError(_ data: Data) -> Error {
        if
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let text = payload["msg"] as? String
                ?? payload["message"] as? String
                ?? payload["error_description"] as? String
        {
            return NSError(domain: "SupabaseAuth", code: 1, userInfo: [
                NSLocalizedDescriptionKey: text
            ])
        }
        return URLError(.badServerResponse)
    }

    private func clearLocalSession() {
        store.removeAll()
        accessToken = nil
        refreshToken = nil
        email = nil
        isRecoveringPassword = false
        isSignedIn = false
    }
}
