export type LabelKind = "subject" | "class" | "topic";
export type Availability = "busy" | "free" | "tentative" | "unavailable";
export type EventOrigin = "web" | "apple" | "import";

export interface Profile {
  timezone: string;
  locale: string;
  weekStart: 0 | 1 | 6;
  calendarView: "dayGridMonth" | "timeGridWeek" | "timeGridDay";
  onboardingComplete: boolean;
}

export interface StudyLabel {
  id: string;
  kind: LabelKind;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  until?: string;
  byWeekday?: string[];
}

export interface CalendarEventRecord {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  subjectId?: string;
  classId?: string;
  topicId?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  url?: string;
  notes?: string;
  availability: Availability;
  travelMinutes: number;
  alerts: number[];
  recurrence?: RecurrenceRule;
  recurrenceSeriesId?: string;
  originalStartAt?: string;
  participants?: Array<{ name?: string; email?: string; status?: string }>;
  attachments?: Array<{ name: string; url?: string }>;
  origin: EventOrigin;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface RevisionItem {
  id: string;
  title: string;
  subjectId?: string;
  classId?: string;
  topicId?: string;
  mastery: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionSession {
  id: string;
  revisionItemId: string;
  sourceEventId?: string;
  revisedAt: string;
  durationMinutes: number;
  mastery: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerState {
  profile: Profile;
  labels: StudyLabel[];
  events: CalendarEventRecord[];
  revisionItems: RevisionItem[];
  sessions: RevisionSession[];
}

export type EntityName = "profiles" | "labels" | "events" | "revision_items" | "revision_sessions";

export interface QueuedMutation {
  id: string;
  entity: EntityName;
  action: "upsert" | "delete";
  payload: unknown;
  queuedAt: string;
}

export interface Repository {
  readonly mode: "local" | "cloud";
  load(): Promise<TrackerState>;
  saveProfile(profile: Profile): Promise<void>;
  saveLabel(label: StudyLabel): Promise<void>;
  deleteLabel(id: string): Promise<void>;
  saveEvent(event: CalendarEventRecord): Promise<void>;
  saveRevisionItem(item: RevisionItem): Promise<void>;
  deleteRevisionItem(id: string): Promise<void>;
  saveSession(session: RevisionSession): Promise<void>;
}
