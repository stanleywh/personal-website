import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createDemoState, createInitialState } from "./seed";
import type {
  CalendarEventRecord,
  Profile,
  QueuedMutation,
  Repository,
  RevisionItem,
  RevisionSession,
  StudyLabel,
  TrackerState,
} from "./types";
import { isoNow, uid } from "./utils";

const STORAGE_KEY = "revision-tracker:v2";
const QUEUE_KEY = "revision-tracker:queue:v1";

function readCache(): TrackerState | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as TrackerState : undefined;
  } catch {
    return undefined;
  }
}

export function cacheState(state: TrackerState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mutateCache(mutator: (state: TrackerState) => void): void {
  const state = readCache() ?? createInitialState();
  mutator(state);
  cacheState(state);
}

function readQueue(): QueuedMutation[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedMutation[];
  } catch {
    return [];
  }
}

function queueMutation(entity: QueuedMutation["entity"], action: QueuedMutation["action"], payload: unknown): void {
  const queue = readQueue();
  queue.push({ id: uid(), entity, action, payload, queuedAt: isoNow() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function queuedMutationCount(): number {
  return readQueue().length;
}

class LocalRepository implements Repository {
  readonly mode = "local" as const;

  async load(): Promise<TrackerState> {
    const cached = readCache();
    if (cached) return cached;
    const seeded = createDemoState();
    cacheState(seeded);
    return seeded;
  }

  async saveProfile(profile: Profile): Promise<void> {
    mutateCache((state) => { state.profile = profile; });
  }

  async saveLabel(label: StudyLabel): Promise<void> {
    mutateCache((state) => {
      const index = state.labels.findIndex((item) => item.id === label.id);
      if (index >= 0) state.labels[index] = label;
      else state.labels.push(label);
    });
  }

  async deleteLabel(id: string): Promise<void> {
    mutateCache((state) => {
      state.labels = state.labels.filter((label) => label.id !== id);
      for (const event of state.events) {
        if (event.subjectId === id) event.subjectId = undefined;
        if (event.classId === id) event.classId = undefined;
        if (event.topicId === id) event.topicId = undefined;
      }
      for (const item of state.revisionItems) {
        if (item.subjectId === id) item.subjectId = undefined;
        if (item.classId === id) item.classId = undefined;
        if (item.topicId === id) item.topicId = undefined;
      }
    });
  }

  async saveEvent(event: CalendarEventRecord): Promise<void> {
    mutateCache((state) => {
      const index = state.events.findIndex((item) => item.id === event.id);
      if (index >= 0) state.events[index] = event;
      else state.events.push(event);
    });
  }

  async saveRevisionItem(item: RevisionItem): Promise<void> {
    mutateCache((state) => {
      const index = state.revisionItems.findIndex((entry) => entry.id === item.id);
      if (index >= 0) state.revisionItems[index] = item;
      else state.revisionItems.push(item);
    });
  }

  async deleteRevisionItem(id: string): Promise<void> {
    mutateCache((state) => {
      state.revisionItems = state.revisionItems.filter((item) => item.id !== id);
      state.sessions = state.sessions.filter((session) => session.revisionItemId !== id);
    });
  }

  async saveSession(session: RevisionSession): Promise<void> {
    mutateCache((state) => {
      const index = state.sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) state.sessions[index] = session;
      else state.sessions.push(session);
    });
  }
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
  constructor(private readonly client: SupabaseClient, private readonly user: User) {}

  private async execute(entity: QueuedMutation["entity"], action: QueuedMutation["action"], payload: unknown, operation: () => PromiseLike<{ error: any }>): Promise<void> {
    if (!navigator.onLine) {
      queueMutation(entity, action, payload);
      throw new Error("You are offline. The change is queued.");
    }
    const { error } = await operation();
    if (error) {
      queueMutation(entity, action, payload);
      throw new Error(error.message ?? "Cloud save failed. The change is queued.");
    }
  }

  async load(): Promise<TrackerState> {
    const [profileResult, labelsResult, eventsResult, revisionsResult, sessionsResult] = await Promise.all([
      this.client.from("profiles").select("*").eq("id", this.user.id).maybeSingle(),
      this.client.from("labels").select("*").order("name"),
      this.client.from("events").select("*, event_labels(label_id, labels(kind))").is("deleted_at", null),
      this.client.from("revision_items").select("*").order("updated_at", { ascending: false }),
      this.client.from("revision_sessions").select("*").order("revised_at", { ascending: false }),
    ]);
    const firstError = [profileResult, labelsResult, eventsResult, revisionsResult, sessionsResult].find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);
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
    cacheState(state);
    return state;
  }

  async saveProfile(profile: Profile): Promise<void> {
    const payload = { id: this.user.id, timezone: profile.timezone, locale: profile.locale, week_start: profile.weekStart, calendar_view: profile.calendarView, onboarding_complete: profile.onboardingComplete };
    await this.execute("profiles", "upsert", payload, () => this.client.from("profiles").upsert(payload));
  }

  async saveLabel(label: StudyLabel): Promise<void> {
    const payload = toLabelRow(label, this.user.id);
    await this.execute("labels", "upsert", payload, () => this.client.from("labels").upsert(payload));
  }

  async deleteLabel(id: string): Promise<void> {
    await this.execute("labels", "delete", { id }, () => this.client.from("labels").delete().eq("id", id));
  }

  async saveEvent(event: CalendarEventRecord): Promise<void> {
    const payload = toEventRow(event, this.user.id);
    await this.execute("events", "upsert", payload, () => this.client.from("events").upsert(payload));
    const labelIds = [event.subjectId, event.classId, event.topicId].filter(Boolean) as string[];
    const { error: deleteError } = await this.client.from("event_labels").delete().eq("event_id", event.id);
    if (deleteError) throw new Error(deleteError.message);
    if (labelIds.length) {
      const { error } = await this.client.from("event_labels").insert(labelIds.map((labelId) => ({ event_id: event.id, label_id: labelId, user_id: this.user.id })));
      if (error) throw new Error(error.message);
    }
  }

  async saveRevisionItem(item: RevisionItem): Promise<void> {
    const payload = toRevisionRow(item, this.user.id);
    await this.execute("revision_items", "upsert", payload, () => this.client.from("revision_items").upsert(payload));
  }

  async deleteRevisionItem(id: string): Promise<void> {
    await this.execute("revision_items", "delete", { id }, () => this.client.from("revision_items").delete().eq("id", id));
  }

  async saveSession(session: RevisionSession): Promise<void> {
    const payload = toSessionRow(session, this.user.id);
    await this.execute("revision_sessions", "upsert", payload, () => this.client.from("revision_sessions").upsert(payload));
  }
}

export interface AuthState {
  configured: boolean;
  user: User | null;
}

export class PersistenceController {
  private client?: SupabaseClient;
  private user: User | null = null;
  private local = new LocalRepository();
  private cloud?: CloudRepository;
  private listeners = new Set<(state: AuthState) => void>();

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (url && key && !url.includes("your-project")) this.client = createClient(url, key);
  }

  async initialize(): Promise<void> {
    if (!this.client) return;
    const { data } = await this.client.auth.getSession();
    this.setUser(data.session?.user ?? null);
    this.client.auth.onAuthStateChange((_event, session) => {
      this.setUser(session?.user ?? null);
    });
  }

  private setUser(user: User | null): void {
    this.user = user;
    this.cloud = user && this.client ? new CloudRepository(this.client, user) : undefined;
    const state = this.authState;
    this.listeners.forEach((listener) => listener(state));
  }

  get authState(): AuthState {
    return { configured: Boolean(this.client), user: this.user };
  }

  get repository(): Repository {
    return this.cloud ?? this.local;
  }

  onAuthChange(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendMagicLink(email: string): Promise<void> {
    if (!this.client) throw new Error("Cloud sync is not configured yet. Add the Supabase environment variables first.");
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split("#")[0] } });
    if (error) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    if (this.client) await this.client.auth.signOut();
  }

  async deleteAccount(): Promise<void> {
    if (!this.client || !this.user) return;
    const { error } = await this.client.functions.invoke("delete-account", { method: "POST" });
    if (error) throw new Error(error.message);
    await this.signOut();
    localStorage.removeItem(STORAGE_KEY);
  }

  async flushQueue(): Promise<number> {
    if (!this.client || !this.user || !navigator.onLine) return queuedMutationCount();
    const queue = readQueue();
    const failed: QueuedMutation[] = [];
    for (const mutation of queue) {
      try {
        const table = mutation.entity;
        if (mutation.action === "delete") {
          const id = (mutation.payload as { id: string }).id;
          const { error } = await this.client.from(table).delete().eq("id", id);
          if (error) throw error;
        } else {
          const { error } = await this.client.from(table).upsert(mutation.payload as Record<string, unknown>);
          if (error) throw error;
        }
      } catch {
        failed.push(mutation);
      }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
    return failed.length;
  }
}
