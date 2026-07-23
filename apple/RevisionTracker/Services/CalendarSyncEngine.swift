import CryptoKit
import EventKit
import Foundation

@MainActor
final class CalendarSyncEngine: ObservableObject {
    @Published private(set) var state: SyncState = .idle
    @Published private(set) var unresolvedConflicts = 0

    private let auth: AuthService
    private let bridge: EventKitBridge
    private let api: TrackerRemoteAPI
    private let deviceId: String
    private var notificationTask: Task<Void, Never>?

    init(auth: AuthService, bridge: EventKitBridge, api: TrackerRemoteAPI) {
        self.auth = auth
        self.bridge = bridge
        self.api = api
        if let saved = UserDefaults.standard.string(forKey: "syncDeviceId") { deviceId = saved }
        else {
            let value = UUID().uuidString
            UserDefaults.standard.set(value, forKey: "syncDeviceId")
            deviceId = value
        }
    }

    func startListening() {
        guard notificationTask == nil else { return }
        notificationTask = Task { [weak self] in
            guard let self else { return }
            for await _ in bridge.changeNotifications {
                guard !Task.isCancelled, auth.isSignedIn, bridge.permission == .authorized else { continue }
                try? await Task.sleep(for: .milliseconds(600))
                await sync()
            }
        }
    }

    func sync() async {
        guard auth.isSignedIn else { state = .failed("Sign in to sync"); return }
        guard let userId = auth.userId else { state = .failed("Your account session is invalid"); return }
        guard bridge.permission == .authorized else { state = .failed("Enable calendar access"); return }
        guard state != .syncing else { return }
        state = .syncing
        do {
            let calendar = try bridge.dedicatedCalendar(for: userId)
            async let remoteRequest = api.fetchEvents()
            async let mappingRequest = api.fetchMappings(deviceId: deviceId)
            let (remoteEvents, mappings) = try await (remoteRequest, mappingRequest)
            let localEvents = bridge.events(in: calendar)
            var mappedLocalIdentifiers = Set<String>()

            for remote in remoteEvents {
                let mapping = mappings.first(where: { $0.eventId == remote.id && $0.occurrenceStartAt == remote.originalStartAt })
                let local = mapping.flatMap { bridge.event(identifier: $0.eventIdentifier) }
                    ?? localEvents.first(where: { $0.calendarItemExternalIdentifier == mapping?.externalIdentifier && mapping?.externalIdentifier != nil })
                    ?? localEvents.first(where: { mapping != nil && $0.title == remote.title && abs($0.startDate.timeIntervalSince(remote.startAt)) < 2 })
                if let identifier = local?.eventIdentifier { mappedLocalIdentifiers.insert(identifier) }
                try await reconcile(remote: remote, local: local, mapping: mapping, calendar: calendar)
            }

            for local in localEvents where !mappedLocalIdentifiers.contains(local.eventIdentifier) {
                let event = bridge.trackerEvent(from: local, id: UUID())
                try await api.upsertEvent(event)
                try await api.upsertMapping(mapping(for: event, appleEvent: local, calendar: calendar))
            }
            state = .complete(.now)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func reconcile(remote: TrackerEvent, local: EKEvent?, mapping: SyncMapping?, calendar: EKCalendar) async throws {
        let remoteHash = try hash(remote)
        guard let local else {
            if remote.deletedAt != nil { return }
            if let mapping {
                var deleted = remote
                deleted.deletedAt = .now
                deleted.updatedAt = .now
                deleted.version += 1
                try await api.upsertEvent(deleted)
                var tombstoneMapping = mapping
                tombstoneMapping.contentHash = try hash(deleted)
                tombstoneMapping.lastSyncedVersion = deleted.version
                tombstoneMapping.lastSyncedAt = .now
                try await api.upsertMapping(tombstoneMapping)
                return
            }
            let saved = try bridge.save(remote, into: calendar)
            try await api.upsertMapping(mapping(for: remote, appleEvent: saved, calendar: calendar, existingId: mapping?.id))
            return
        }
        let appleRecord = bridge.trackerEvent(from: local, id: remote.id)
        let localHash = try hash(appleRecord)
        let lastHash = mapping?.contentHash
        let cloudChanged = remoteHash != lastHash
        let appleChanged = localHash != lastHash

        if cloudChanged && appleChanged {
            let appleWins = (local.lastModifiedDate ?? .distantPast) > remote.updatedAt
            let conflict = SyncConflict(
                id: UUID(), eventId: remote.id, deviceId: deviceId,
                cloudPayload: summary(remote), applePayload: summary(appleRecord),
                winner: appleWins ? "apple" : "cloud", status: "unresolved", createdAt: .now
            )
            try await api.saveConflict(conflict)
            unresolvedConflicts += 1
            if appleWins {
                var updated = appleRecord
                updated.version = remote.version + 1
                updated.updatedAt = local.lastModifiedDate ?? .now
                try await api.upsertEvent(updated)
                try await api.upsertMapping(mapping(for: updated, appleEvent: local, calendar: calendar, existingId: mapping?.id))
            } else {
                let saved = try bridge.save(remote, into: calendar, existing: local)
                try await api.upsertMapping(mapping(for: remote, appleEvent: saved, calendar: calendar, existingId: mapping?.id))
            }
        } else if cloudChanged {
            let saved = try bridge.save(remote, into: calendar, existing: local)
            try await api.upsertMapping(mapping(for: remote, appleEvent: saved, calendar: calendar, existingId: mapping?.id))
        } else if appleChanged {
            var updated = appleRecord
            updated.version = remote.version + 1
            updated.updatedAt = local.lastModifiedDate ?? .now
            try await api.upsertEvent(updated)
            try await api.upsertMapping(mapping(for: updated, appleEvent: local, calendar: calendar, existingId: mapping?.id))
        }
    }

    private func mapping(for event: TrackerEvent, appleEvent: EKEvent, calendar: EKCalendar, existingId: UUID? = nil) -> SyncMapping {
        SyncMapping(
            id: existingId ?? UUID(), eventId: event.id, deviceId: deviceId, calendarIdentifier: calendar.calendarIdentifier,
            eventIdentifier: appleEvent.eventIdentifier, externalIdentifier: appleEvent.calendarItemExternalIdentifier,
            occurrenceStartAt: event.originalStartAt, contentHash: (try? hash(event)) ?? "", lastSyncedVersion: event.version, lastSyncedAt: .now
        )
    }

    private func hash(_ event: TrackerEvent) throws -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let fingerprint = EventFingerprint(
            title: event.title, startAt: event.startAt, endAt: event.endAt, allDay: event.allDay, timezone: event.timezone,
            location: event.location, url: event.url?.absoluteString, notes: event.notes, availability: event.availability.rawValue,
            travelMinutes: event.travelMinutes, alerts: event.alerts.sorted(), recurrence: event.recurrence
        )
        let digest = SHA256.hash(data: try encoder.encode(fingerprint))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func summary(_ event: TrackerEvent) -> [String: JSONValue] {
        ["id": .string(event.id.uuidString), "title": .string(event.title), "startAt": .string(event.startAt.ISO8601Format()), "endAt": .string(event.endAt.ISO8601Format()), "version": .number(Double(event.version))]
    }
}

private struct EventFingerprint: Codable {
    let title: String
    let startAt: Date
    let endAt: Date
    let allDay: Bool
    let timezone: String
    let location: String?
    let url: String?
    let notes: String?
    let availability: String
    let travelMinutes: Int
    let alerts: [Int]
    let recurrence: TrackerEvent.RecurrenceRule?
}
