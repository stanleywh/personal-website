import EventKit
import Foundation

@MainActor
final class EventKitBridge: ObservableObject {
    static let calendarTitle = "Revision Tracker"
    private let store = EKEventStore()

    @Published private(set) var permission: CalendarPermissionState = .notDetermined

    init() { refreshPermission() }

    func refreshPermission() {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .authorized: permission = .authorized
        case .denied: permission = .denied
        case .restricted: permission = .restricted
        default: permission = .notDetermined
        }
    }

    func requestAccess() async throws -> Bool {
        let granted = try await store.requestFullAccessToEvents()
        refreshPermission()
        return granted
    }

    func dedicatedCalendar(for userId: String) throws -> EKCalendar {
        let calendarKey = "revisionTrackerCalendarIdentifier.\(userId)"
        if let identifier = UserDefaults.standard.string(forKey: calendarKey), let calendar = store.calendar(withIdentifier: identifier) { return calendar }
        guard let source = store.defaultCalendarForNewEvents?.source ?? store.sources.first(where: { $0.sourceType == .calDAV || $0.sourceType == .local }) else {
            throw NSError(domain: "EventKitBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: "No writable calendar account is available."])
        }
        let calendar = EKCalendar(for: .event, eventStore: store)
        calendar.title = Self.calendarTitle
        calendar.source = source
        try store.saveCalendar(calendar, commit: true)
        UserDefaults.standard.set(calendar.calendarIdentifier, forKey: calendarKey)
        return calendar
    }

    func events(in calendar: EKCalendar) -> [EKEvent] {
        let start = Calendar.current.date(byAdding: .year, value: -5, to: .now)!
        let end = Calendar.current.date(byAdding: .year, value: 10, to: .now)!
        return store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: [calendar]))
    }

    func event(identifier: String?) -> EKEvent? {
        guard let identifier else { return nil }
        return store.event(withIdentifier: identifier)
    }

    func save(_ remote: TrackerEvent, into calendar: EKCalendar, existing: EKEvent? = nil) throws -> EKEvent {
        let event = existing ?? EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = remote.title
        event.startDate = remote.startAt
        event.endDate = remote.endAt
        event.isAllDay = remote.allDay
        event.timeZone = TimeZone(identifier: remote.timezone)
        event.location = remote.location
        event.notes = remote.notes
        event.url = remote.url
        event.travelTime = TimeInterval(remote.travelMinutes * 60)
        event.availability = switch remote.availability { case .busy: .busy; case .free: .free; case .tentative: .tentative; case .unavailable: .unavailable }
        event.alarms = remote.alerts.map { EKAlarm(relativeOffset: TimeInterval(-$0 * 60)) }
        event.recurrenceRules?.forEach { event.removeRecurrenceRule($0) }
        if let rule = remote.recurrence {
            let frequency: EKRecurrenceFrequency = switch rule.frequency { case .daily: .daily; case .weekly: .weekly; case .monthly: .monthly; case .yearly: .yearly }
            let recurrenceEnd = rule.until.flatMap { ISO8601DateFormatter().date(from: "\($0)T23:59:59Z") }.map(EKRecurrenceEnd.init(end:))
            event.addRecurrenceRule(EKRecurrenceRule(recurrenceWith: frequency, interval: rule.interval, end: recurrenceEnd))
        }
        if remote.deletedAt != nil {
            if existing != nil { try store.remove(event, span: .futureEvents, commit: true) }
        } else {
            try store.save(event, span: .futureEvents, commit: true)
        }
        return event
    }

    func trackerEvent(from event: EKEvent, id: UUID) -> TrackerEvent {
        let recurrence = event.recurrenceRules?.first.map { rule -> TrackerEvent.RecurrenceRule in
            let frequency: TrackerEvent.RecurrenceRule.Frequency = switch rule.frequency { case .daily: .daily; case .weekly: .weekly; case .monthly: .monthly; default: .yearly }
            let until = rule.recurrenceEnd?.endDate.map { $0.formatted(.iso8601.year().month().day()) }
            return .init(frequency: frequency, interval: rule.interval, until: until)
        }
        TrackerEvent(
            id: id, title: event.title ?? "Untitled event", startAt: event.startDate, endAt: event.endDate,
            allDay: event.isAllDay, timezone: event.timeZone?.identifier ?? TimeZone.current.identifier,
            location: event.location, url: event.url, notes: event.notes,
            availability: switch event.availability { case .free: .free; case .tentative: .tentative; case .unavailable: .unavailable; default: .busy },
            travelMinutes: Int(event.travelTime / 60), alerts: (event.alarms ?? []).filter { $0.absoluteDate == nil }.map { Int(abs($0.relativeOffset) / 60) }, recurrence: recurrence,
            origin: .apple, version: 1, createdAt: event.creationDate ?? .now, updatedAt: event.lastModifiedDate ?? .now
        )
    }

    var changeNotifications: NotificationCenter.Notifications {
        NotificationCenter.default.notifications(named: .EKEventStoreChanged)
    }
}
