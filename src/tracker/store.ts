import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAuthorizationFailure, requireSupabase } from "../auth/client";
import { authController, profileCacheKey, type AuthSnapshot } from "../auth/session";
import { createInitialState } from "./seed";
import type {
  CalendarEventRecord,
  Profile,
  QueuedMutation,
  QueueOperation,
  Repository,
  RevisionItem,
  RevisionSession,
  StudyLabel,
  TrackerState,
} from "./types";
import { isoNow, uid } from "./utils";

export const LEGACY_STATE_KEY = "revision-tracker:v2";
export const LEGACY_QUEUE_KEY = "revision-tracker:queue:v1";

export class TrackerAuthorizationError extends Error {
  constructor(message = "Your session has expired. Sign in again.") {
    super(message);
    this.name = "TrackerAuthorizationError";
  }
}

export function stateKey(userId: string): string {
  return `revision-tracker:user:${userId}:state:v3`;
}

export function queueKey(userId: string): string {
  return `revision-tracker:user:${userId}:queue:v2`;
}

export function legacyDismissedKey(userId: string): string {
  return `revision-tracker:user:${userId}:legacy-dismissed:v1`;
}

export function legacyImportPendingKey(userId: string): string {
  return `revision-tracker:user:${userId}:legacy-import-pending:v1`;
}

function isTrackerState(value: unknown): value is TrackerState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TrackerState>;
  return Boolean(candidate.profile && typeof candidate.profile === "object")
    && Array.isArray(candidate.labels)
    && Array.isArray(candidate.events)
    && Array.isArray(candidate.revisionItems)
    && Array.isArray(candidate.sessions);
}

export function readUserCache(userId: string): TrackerState | undefined {
  try {
    const raw = localStorage.getItem(stateKey(userId));
    const parsed = raw ? JSON.parse(raw) as unknown : undefined;
    return isTrackerState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function cacheUserState(userId: string, state: TrackerState): void {
  localStorage.setItem(stateKey(userId), JSON.stringify(state));
}

export function readLegacyState(): TrackerState | undefined {
  try {
    const raw = localStorage.getItem(LEGACY_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : undefined;
    return isTrackerState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function trackerStateIsEmpty(state: TrackerState): boolean {
  return state.labels.length === 0
    && state.events.length === 0
    && state.revisionItems.length === 0
    && state.sessions.length === 0;
}

export function legacyRecordCounts(state: TrackerState): {
  events: number;
  labels: number;
  revisionItems: number;
  sessions: number;
} {
  return {
    events: state.events.length,
    labels: state.labels.length,
    revisionItems: state.revisionItems.length,
    sessions: state.sessions.length,
  };
}

export function readUserQueue(userId: string): QueuedMutation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueKey(userId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<QueueOperation>([
      "save_profile",
      "save_label",
      "delete_label",
      "save_event",
      "save_revision_item",
      "delete_revision_item",
      "save_session",
    ]);
    return parsed.filter((entry): entry is QueuedMutation => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<QueuedMutation>;
      return candidate.ownerId === userId
        && typeof candidate.id === "string"
        && typeof candidate.queuedAt === "string"
        && typeof candidate.operation === "string"
        && allowed.has(candidate.operation as QueueOperation);
    });
  } catch {
    return [];
  }
}

function writeQueue(userId: string, queue: QueuedMutation[]): void {
  localStorage.setItem(queueKey(userId), JSON.stringify(queue));
}

function queueMutation(userId: string, operation: QueueOperation, payload: unknown): void {
  const queue = readUserQueue(userId);
  queue.push({ id: uid(), ownerId: userId, operation, payload, queuedAt: isoNow() });
  writeQueue(userId, queue);
}

const toLabelRow = (label: StudyLabel, userId: string) => ({
  id: label.id, user_id: userId, kind: label.kind, name: label.name, color: label.color,
  created_at: label.createdAt, updated_at: label.updatedAt,
});

const fromLabelRow = (row: Record<string, unknown>): StudyLabel => ({
  id: String(row.id), kind: row.kind as StudyLabel["kind"], name: String(row.name), color: String(row.color),
  createdAt: String(row.created_at), updatedAt: String(row.updated_at),
});

const toEventRow = (event: CalendarEventRecord, userId: string) => ({
  id: event.id, user_id: userId, title: event.title, start_at: event.startAt, end_at: event.endAt,
  all_day: event.allDay, timezone: event.timezone, location: event.location ?? null,
  subject_id: event.subjectId ?? null, class_id: event.classId ?? null, topic_id: event.topicId ?? null,
  latitude: event.latitude ?? null, longitude: event.longitude ?? null, url: event.url ?? null,
  notes: event.notes ?? null, availability: event.availability, travel_minutes: event.travelMinutes,
  alerts: event.alerts, recurrence: event.recurrence ?? null, recurrence_series_id: event.recurrenceSeriesId ?? null,
  original_start_at: event.originalStartAt ?? null, participants: event.participants ?? [], attachments: event.attachments ?? [],
  origin: event.origin, version: event.version, created_at: event.createdAt, updated_at: event.updatedAt,
  deleted_at: event.deletedAt ?? null,
});

const fromEventRow = (row: Record<string, any>): CalendarEventRecord => {
  const associations = Array.isArray(row.event_labels) ? row.event_labels : [];
  const labelFor = (kind: string): string | undefined => associations.find((entry: any) => entry.labels?.kind === kind)?.label_id;
  return {
    id: String(row.id), title: String(row.title), startAt: String(row.start_at), endAt: String(row.end_at),
    allDay: Boolean(row.all_day), timezone: String(row.timezone), subjectId: row.subject_id ?? labelFor("subject"), classId: row.class_id ?? labelFor("class"),
    topicId: row.topic_id ?? labelFor("topic"), location: row.location ?? undefined, latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined, url: row.url ?? undefined, notes: row.notes ?? undefined,
    availability: row.availability, travelMinutes: Number(row.travel_minutes ?? 0), alerts: row.alerts ?? [],
    recurrence: row.recurrence ?? undefined, recurrenceSeriesId: row.recurrence_series_id ?? undefined,
    originalStartAt: row.original_start_at ?? undefined, participants: row.participants ?? [], attachments: row.attachments ?? [],
    origin: row.origin, version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ?? undefined,
  };
};

const toRevisionRow = (item: RevisionItem, userId: string) => ({
  id: item.id, user_id: userId, title: item.title, subject_id: item.subjectId ?? null,
  class_id: item.classId ?? null, topic_id: item.topicId ?? null, mastery: item.mastery,
  notes: item.notes ?? null, created_at: item.createdAt, updated_at: item.updatedAt,
});

const fromRevisionRow = (row: Record<string, any>): RevisionItem => ({
  id: String(row.id), title: String(row.title), subjectId: row.subject_id ?? undefined,
  classId: row.class_id ?? undefined, topicId: row.topic_id ?? undefined, mastery: row.mastery,
  notes: row.notes ?? undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
});

const toSessionRow = (session: RevisionSession, userId: string) => ({
  id: session.id, user_id: userId, revision_item_id: session.revisionItemId,
  source_event_id: session.sourceEventId ?? null, revised_at: session.revisedAt,
  duration_minutes: session.durationMinutes, mastery: session.mastery, notes: session.notes ?? null,
  created_at: session.createdAt, updated_at: session.updatedAt,
});

const fromSessionRow = (row: Record<string, any>): RevisionSession => ({
  id: String(row.id), revisionItemId: String(row.revision_item_id), sourceEventId: row.source_event_id ?? undefined,
  revisedAt: String(row.revised_at), durationMinutes: Number(row.duration_minutes), mastery: row.mastery,
  notes: row.notes ?? undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
});

class CloudRepository implements Repository {
  readonly mode = "cloud" as const;

  constructor(
    private readonly client: SupabaseClient,
    private readonly user: User,
  ) {}

  private throwForFailure(result: { error: { message?: string; code?: string } | null; status?: number }): void {
    if (!result.error) return;
    if (isAuthorizationFailure(result.error, result.status)) {
      throw new TrackerAuthorizationError();
    }
    throw new Error(result.error.message ?? "Cloud save failed.");
  }

  private async runMutation(operation: QueueOperation, payload: any): Promise<void> {
    switch (operation) {
      case "save_profile": {
        this.throwForFailure(await this.client.from("profiles").upsert(payload));
        break;
      }
      case "save_label": {
        this.throwForFailure(await this.client.from("labels").upsert(payload));
        break;
      }
      case "delete_label": {
        this.throwForFailure(await this.client.from("labels").delete().eq("id", String(payload.id)));
        break;
      }
      case "save_event": {
        this.throwForFailure(await this.client.from("events").upsert(payload.event));
        this.throwForFailure(
          await this.client.from("event_labels").delete().eq("event_id", String(payload.event.id)),
        );
        if (payload.labelIds.length) {
          this.throwForFailure(await this.client.from("event_labels").insert(
            payload.labelIds.map((labelId: string) => ({
              event_id: payload.event.id,
              label_id: labelId,
              user_id: this.user.id,
            })),
          ));
        }
        break;
      }
      case "save_revision_item": {
        this.throwForFailure(await this.client.from("revision_items").upsert(payload));
        break;
      }
      case "delete_revision_item": {
        this.throwForFailure(await this.client.from("revision_items").delete().eq("id", String(payload.id)));
        break;
      }
      case "save_session": {
        this.throwForFailure(await this.client.from("revision_sessions").upsert(payload));
        break;
      }
    }
  }

  private async execute(operation: QueueOperation, payload: unknown): Promise<void> {
    if (!navigator.onLine) {
      queueMutation(this.user.id, operation, payload);
      throw new Error("You are offline. The change is queued.");
    }
    try {
      await this.runMutation(operation, payload);
    } catch (error) {
      if (error instanceof TrackerAuthorizationError) throw error;
      queueMutation(this.user.id, operation, payload);
      throw error;
    }
  }

  async load(): Promise<TrackerState> {
    if (!navigator.onLine) return readUserCache(this.user.id) ?? createInitialState();
    const [profileResult, labelsResult, eventsResult, revisionsResult, sessionsResult] = await Promise.all([
      this.client.from("profiles").select("*").eq("id", this.user.id).maybeSingle(),
      this.client.from("labels").select("*").order("name"),
      this.client.from("events").select("*, event_labels(label_id, labels(kind))").is("deleted_at", null),
      this.client.from("revision_items").select("*").order("updated_at", { ascending: false }),
      this.client.from("revision_sessions").select("*").order("revised_at", { ascending: false }),
    ]);
    const failedResult = [profileResult, labelsResult, eventsResult, revisionsResult, sessionsResult]
      .find((result) => result.error);
    if (failedResult?.error) {
      if (isAuthorizationFailure(failedResult.error, failedResult.status)) {
        throw new TrackerAuthorizationError();
      }
      const cached = readUserCache(this.user.id);
      if (cached) return cached;
      throw new Error(failedResult.error.message);
    }
    const fallback = createInitialState();
    const profileRow = profileResult.data as Record<string, any> | null;
    const state: TrackerState = {
      profile: profileRow ? {
        timezone: profileRow.timezone, locale: profileRow.locale, weekStart: profileRow.week_start,
        calendarView: profileRow.calendar_view, onboardingComplete: profileRow.onboarding_complete,
      } : fallback.profile,
      labels: (labelsResult.data ?? []).map((row) => fromLabelRow(row)),
      events: (eventsResult.data ?? []).map((row) => fromEventRow(row)),
      revisionItems: (revisionsResult.data ?? []).map((row) => fromRevisionRow(row)),
      sessions: (sessionsResult.data ?? []).map((row) => fromSessionRow(row)),
    };
    cacheUserState(this.user.id, state);
    return state;
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.execute("save_profile", {
      id: this.user.id,
      timezone: profile.timezone,
      locale: profile.locale,
      week_start: profile.weekStart,
      calendar_view: profile.calendarView,
      onboarding_complete: profile.onboardingComplete,
    });
  }

  async saveLabel(label: StudyLabel): Promise<void> {
    await this.execute("save_label", toLabelRow(label, this.user.id));
  }

  async deleteLabel(id: string): Promise<void> {
    await this.execute("delete_label", { id });
  }

  async saveEvent(event: CalendarEventRecord): Promise<void> {
    await this.execute("save_event", {
      event: toEventRow(event, this.user.id),
      labelIds: [event.subjectId, event.classId, event.topicId].filter(Boolean),
    });
  }

  async saveRevisionItem(item: RevisionItem): Promise<void> {
    await this.execute("save_revision_item", toRevisionRow(item, this.user.id));
  }

  async deleteRevisionItem(id: string): Promise<void> {
    await this.execute("delete_revision_item", { id });
  }

  async saveSession(session: RevisionSession): Promise<void> {
    await this.execute("save_session", toSessionRow(session, this.user.id));
  }

  async flushQueue(): Promise<number> {
    if (!navigator.onLine) return readUserQueue(this.user.id).length;
    const failed: QueuedMutation[] = [];
    for (const mutation of readUserQueue(this.user.id)) {
      try {
        await this.runMutation(mutation.operation, mutation.payload);
      } catch (error) {
        if (error instanceof TrackerAuthorizationError) throw error;
        failed.push(mutation);
      }
    }
    writeQueue(this.user.id, failed);
    return failed.length;
  }
}

export class PersistenceController {
  private user?: User;
  private cloud?: CloudRepository;

  async initialize(): Promise<void> {
    const auth = await authController.initialize();
    if (auth.phase !== "signedIn" || !auth.user) throw new Error("Sign in before opening the Revision Tracker.");
    this.user = auth.user;
    this.cloud = new CloudRepository(requireSupabase(), auth.user);
  }

  get userId(): string {
    if (!this.user) throw new Error("No authenticated user.");
    return this.user.id;
  }

  get authState(): AuthSnapshot {
    return authController.state;
  }

  get repository(): Repository {
    if (!this.cloud) throw new Error("Tracker persistence is not initialized.");
    return this.cloud;
  }

  cacheState(state: TrackerState): void {
    cacheUserState(this.userId, state);
  }

  queuedMutationCount(): number {
    return readUserQueue(this.userId).length;
  }

  onAuthChange(listener: (state: AuthSnapshot) => void): () => void {
    return authController.onChange(listener);
  }

  async signOut(): Promise<void> {
    await authController.signOut();
  }

  async deleteAccount(): Promise<void> {
    const userId = this.userId;
    await authController.deleteAccount();
    localStorage.removeItem(stateKey(userId));
    localStorage.removeItem(queueKey(userId));
    localStorage.removeItem(profileCacheKey(userId));
    localStorage.removeItem(legacyDismissedKey(userId));
    localStorage.removeItem(legacyImportPendingKey(userId));
  }

  async flushQueue(): Promise<number> {
    return this.cloud?.flushQueue() ?? 0;
  }

  legacyState(): TrackerState | undefined {
    if (localStorage.getItem(legacyDismissedKey(this.userId))) return undefined;
    return readLegacyState();
  }

  dismissLegacy(): void {
    localStorage.setItem(legacyDismissedKey(this.userId), "kept");
    localStorage.removeItem(legacyImportPendingKey(this.userId));
  }

  discardLegacy(): void {
    localStorage.removeItem(LEGACY_STATE_KEY);
    localStorage.removeItem(LEGACY_QUEUE_KEY);
    localStorage.removeItem(legacyImportPendingKey(this.userId));
    localStorage.setItem(legacyDismissedKey(this.userId), "discarded");
  }

  legacyImportPending(): boolean {
    return localStorage.getItem(legacyImportPendingKey(this.userId)) === "pending";
  }

  async importLegacy(state: TrackerState): Promise<void> {
    if (!this.cloud) throw new Error("Tracker persistence is not initialized.");
    localStorage.setItem(legacyImportPendingKey(this.userId), "pending");
    await this.cloud.saveProfile(state.profile);
    for (const label of state.labels) await this.cloud.saveLabel(label);
    for (const event of state.events) await this.cloud.saveEvent(event);
    for (const item of state.revisionItems) await this.cloud.saveRevisionItem(item);
    for (const session of state.sessions) await this.cloud.saveSession(session);
    cacheUserState(this.userId, state);
    localStorage.removeItem(LEGACY_STATE_KEY);
    localStorage.removeItem(LEGACY_QUEUE_KEY);
    localStorage.removeItem(legacyImportPendingKey(this.userId));
    localStorage.setItem(legacyDismissedKey(this.userId), "imported");
  }
}
