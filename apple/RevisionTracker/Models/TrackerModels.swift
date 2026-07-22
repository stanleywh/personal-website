import Foundation

struct TrackerEvent: Codable, Identifiable, Hashable, Sendable {
    enum Availability: String, Codable, Sendable { case busy, free, tentative, unavailable }
    enum Origin: String, Codable, Sendable { case web, apple, importSource = "import" }

    var id: UUID
    var title: String
    var startAt: Date
    var endAt: Date
    var allDay: Bool
    var timezone: String
    var location: String?
    var latitude: Double?
    var longitude: Double?
    var url: URL?
    var notes: String?
    var availability: Availability
    var travelMinutes: Int
    var alerts: [Int]
    var recurrence: RecurrenceRule?
    var recurrenceSeriesId: UUID?
    var originalStartAt: Date?
    var origin: Origin
    var version: Int
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    struct RecurrenceRule: Codable, Hashable, Sendable {
        enum Frequency: String, Codable, Sendable { case daily, weekly, monthly, yearly }
        var frequency: Frequency
        var interval: Int
        var until: String?
        var byWeekday: [String]?
    }
}

struct SyncMapping: Codable, Identifiable, Sendable {
    var id: UUID
    var eventId: UUID
    var deviceId: String
    var calendarIdentifier: String
    var eventIdentifier: String?
    var externalIdentifier: String?
    var occurrenceStartAt: Date?
    var contentHash: String
    var lastSyncedVersion: Int
    var lastSyncedAt: Date?
}

struct SyncConflict: Codable, Identifiable, Sendable {
    var id: UUID
    var eventId: UUID?
    var deviceId: String
    var cloudPayload: [String: JSONValue]
    var applePayload: [String: JSONValue]
    var winner: String
    var status: String
    var createdAt: Date
}

enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else { self = .array(try container.decode([JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

enum CalendarPermissionState: String, Sendable {
    case notDetermined = "Not enabled"
    case authorized = "Full access"
    case denied = "Access denied"
    case restricted = "Restricted"
}

enum SyncState: Equatable, Sendable {
    case idle, syncing, complete(Date), failed(String)

    var label: String {
        switch self {
        case .idle: "Ready"
        case .syncing: "Syncing…"
        case .complete(let date): "Synced \(date.formatted(date: .omitted, time: .shortened))"
        case .failed(let message): message
        }
    }
}
