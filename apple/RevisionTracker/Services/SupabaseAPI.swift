import Foundation

@MainActor protocol TrackerRemoteAPI: Sendable {
    func fetchEvents() async throws -> [TrackerEvent]
    func upsertEvent(_ event: TrackerEvent) async throws
    func fetchMappings(deviceId: String) async throws -> [SyncMapping]
    func upsertMapping(_ mapping: SyncMapping) async throws
    func saveConflict(_ conflict: SyncConflict) async throws
}

@MainActor final class SupabaseAPI: TrackerRemoteAPI, @unchecked Sendable {
    private let auth: AuthService
    private let baseURL: URL
    private let anonKey: String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(auth: AuthService) {
        self.auth = auth
        let root = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String ?? "https://YOUR_PROJECT.supabase.co"
        baseURL = URL(string: root)!
        anonKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String
            ?? "YOUR_PUBLIC_KEY"
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.keyEncodingStrategy = .convertToSnakeCase
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let precise = ISO8601DateFormatter()
            precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = precise.date(from: value) { return date }
            let standard = ISO8601DateFormatter()
            if let date = standard.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: try decoder.singleValueContainer(), debugDescription: "Invalid ISO-8601 date")
        }
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    private func request(path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil, prefer: String? = nil) async throws -> Data {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/\(path)"), resolvingAgainstBaseURL: false)!
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(try await auth.validAccessToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { request.setValue(prefer, forHTTPHeaderField: "Prefer") }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 500
        guard 200..<300 ~= status else { throw NSError(domain: "SupabaseAPI", code: status, userInfo: [NSLocalizedDescriptionKey: String(data: data, encoding: .utf8) ?? "Cloud request failed"]) }
        return data
    }

    private func payload<T: Encodable>(_ value: T) throws -> Data {
        guard let userId = auth.userId else { throw URLError(.userAuthenticationRequired) }
        let encoded = try encoder.encode(value)
        guard var object = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] else { throw URLError(.cannotParseResponse) }
        object["user_id"] = userId
        return try JSONSerialization.data(withJSONObject: [object])
    }

    func fetchEvents() async throws -> [TrackerEvent] {
        let data = try await request(path: "events", query: [URLQueryItem(name: "select", value: "*"), URLQueryItem(name: "order", value: "updated_at.asc")])
        return try decoder.decode([TrackerEvent].self, from: data)
    }

    func upsertEvent(_ event: TrackerEvent) async throws {
        _ = try await request(path: "events", method: "POST", query: [URLQueryItem(name: "on_conflict", value: "id")], body: try payload(event), prefer: "resolution=merge-duplicates,return=minimal")
    }

    func fetchMappings(deviceId: String) async throws -> [SyncMapping] {
        let data = try await request(path: "calendar_sync_mappings", query: [URLQueryItem(name: "select", value: "*"), URLQueryItem(name: "device_id", value: "eq.\(deviceId)")])
        return try decoder.decode([SyncMapping].self, from: data)
    }

    func upsertMapping(_ mapping: SyncMapping) async throws {
        _ = try await request(path: "calendar_sync_mappings", method: "POST", query: [URLQueryItem(name: "on_conflict", value: "id")], body: try payload(mapping), prefer: "resolution=merge-duplicates,return=minimal")
    }

    func saveConflict(_ conflict: SyncConflict) async throws {
        _ = try await request(path: "sync_conflicts", method: "POST", body: try payload(conflict), prefer: "return=minimal")
    }
}
