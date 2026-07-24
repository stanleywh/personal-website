import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  isAuthorizationFailure,
  isSupabaseConfigured,
  supabase,
} from "./client";
import { validatePassword } from "./password";

export type AuthPhase =
  | "loading"
  | "signedOut"
  | "signedIn"
  | "profileIncomplete"
  | "passwordRecovery"
  | "error";

export interface AccountProfile {
  displayName: string | null;
}

export interface AuthSnapshot {
  phase: AuthPhase;
  configured: boolean;
  session: Session | null;
  user: User | null;
  profile: AccountProfile | null;
  message?: string;
}

type AuthListener = (snapshot: AuthSnapshot) => void;

const initialSnapshot: AuthSnapshot = {
  phase: "loading",
  configured: isSupabaseConfigured,
  session: null,
  user: null,
  profile: null,
};

export function profileCacheKey(userId: string): string {
  return `revision-tracker:user:${userId}:profile:v1`;
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 50 ? trimmed : null;
}

function readProfileCache(userId: string): AccountProfile | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(profileCacheKey(userId)) ?? "null") as AccountProfile | null;
    return parsed ? { displayName: normalizeDisplayName(parsed.displayName) } : null;
  } catch {
    return null;
  }
}

function writeProfileCache(userId: string, profile: AccountProfile): void {
  localStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
}

export class AuthController {
  private snapshot: AuthSnapshot;
  private listeners = new Set<AuthListener>();
  private initializePromise?: Promise<AuthSnapshot>;
  private authSubscription?: { unsubscribe(): void };
  private recoveryActive = false;
  private sessionApplication = 0;

  constructor(private readonly client: SupabaseClient | null = supabase) {
    this.snapshot = {
      ...initialSnapshot,
      configured: Boolean(client),
    };
  }

  get state(): AuthSnapshot {
    return this.snapshot;
  }

  onChange(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): Promise<AuthSnapshot> {
    this.initializePromise ??= this.initializeInternal();
    return this.initializePromise;
  }

  private emit(next: AuthSnapshot): AuthSnapshot {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  private async initializeInternal(): Promise<AuthSnapshot> {
    if (!this.client) {
      return this.emit({
        ...initialSnapshot,
        phase: "error",
        message: "Accounts are not configured in this build.",
      });
    }

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const callbackError = params.get("error_description");
    if (callbackError) {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
      return this.emit({
        ...initialSnapshot,
        configured: true,
        phase: "error",
        message: callbackError,
      });
    }

    const { data: authListener } = this.client.auth.onAuthStateChange((event, session) => {
      this.handleAuthEvent(event, session);
    });
    this.authSubscription = authListener.subscription;

    const { data, error } = await this.client.auth.getSession();
    if (window.location.hash) {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    }
    if (error) {
      return this.emit({
        ...initialSnapshot,
        configured: true,
        phase: "error",
        message: error.message,
      });
    }
    return this.applySession(data.session);
  }

  private handleAuthEvent(event: AuthChangeEvent, session: Session | null): void {
    if (event === "PASSWORD_RECOVERY") this.recoveryActive = Boolean(session);
    if (event === "SIGNED_OUT") this.recoveryActive = false;
    void this.applySession(session);
  }

  private async applySession(session: Session | null): Promise<AuthSnapshot> {
    const application = ++this.sessionApplication;
    const isCurrent = (): boolean => application === this.sessionApplication;

    if (!session) {
      return this.emit({
        phase: "signedOut",
        configured: Boolean(this.client),
        session: null,
        user: null,
        profile: null,
      });
    }

    const fallback = readProfileCache(session.user.id) ?? {
      displayName: normalizeDisplayName(session.user.user_metadata.display_name),
    };

    if (this.recoveryActive) {
      return this.emit({
        phase: "passwordRecovery",
        configured: true,
        session,
        user: session.user,
        profile: fallback,
      });
    }

    this.emit({
      phase: "loading",
      configured: true,
      session,
      user: session.user,
      profile: null,
    });

    if (!navigator.onLine) {
      return this.emit({
        phase: fallback.displayName ? "signedIn" : "profileIncomplete",
        configured: true,
        session,
        user: session.user,
        profile: fallback,
      });
    }

    const client = this.requireClient();
    const { data, error, status } = await client
      .from("profiles")
      .select("display_name")
      .eq("id", session.user.id)
      .maybeSingle();

    if (!isCurrent()) return this.snapshot;

    if (this.recoveryActive) {
      return this.emit({
        phase: "passwordRecovery",
        configured: true,
        session,
        user: session.user,
        profile: fallback,
      });
    }

    if (error) {
      if (isAuthorizationFailure(error, status)) {
        await client.auth.signOut({ scope: "local" });
        if (!isCurrent()) return this.snapshot;
        return this.emit({
          phase: "signedOut",
          configured: true,
          session: null,
          user: null,
          profile: null,
          message: "Your session has expired. Sign in again.",
        });
      }
      if (fallback.displayName) {
        return this.emit({
          phase: "signedIn",
          configured: true,
          session,
          user: session.user,
          profile: fallback,
          message: "Using your cached profile while the account service is unavailable.",
        });
      }
      return this.emit({
        phase: "error",
        configured: true,
        session,
        user: session.user,
        profile: null,
        message: error.message,
      });
    }

    const profile = { displayName: normalizeDisplayName(data?.display_name) };
    writeProfileCache(session.user.id, profile);
    return this.emit({
      phase: profile.displayName ? "signedIn" : "profileIncomplete",
      configured: true,
      session,
      user: session.user,
      profile,
    });
  }

  async signUp(
    email: string,
    password: string,
    options: { displayName?: string; redirectTo: string },
  ): Promise<void> {
    const client = this.requireClient();
    const displayName = normalizeDisplayName(options.displayName);
    if (!displayName) {
      throw new Error("Enter a display name between 1 and 50 characters.");
    }
    validatePassword(password);
    const { error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: options.redirectTo,
        data: {
          display_name: displayName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          locale: navigator.language || "en-GB",
        },
      },
    });
    if (error) throw new Error(error.message);
  }

  async signInWithPassword(email: string, password: string): Promise<AuthSnapshot> {
    const client = this.requireClient();
    this.recoveryActive = false;
    this.sessionApplication += 1;
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(error.message);
    return this.applySession(data.session);
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) {
      throw new Error("Password reset could not be requested right now. Try again later.");
    }
  }

  async completePasswordRecovery(password: string): Promise<AuthSnapshot> {
    if (!this.recoveryActive || !this.snapshot.session) {
      throw new Error("Open a current password reset link before choosing a new password.");
    }
    validatePassword(password);
    const client = this.requireClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    this.recoveryActive = false;
    this.sessionApplication += 1;
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError || !data.session) {
      throw new Error(sessionError?.message ?? "The updated session could not be restored.");
    }
    return this.applySession(data.session);
  }

  async changePassword(password: string): Promise<void> {
    if (
      !this.snapshot.session
      || this.recoveryActive
      || this.snapshot.phase === "passwordRecovery"
    ) {
      throw new Error("Sign in normally before changing your password.");
    }
    validatePassword(password);
    const client = this.requireClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }

  async updateDisplayName(value: string): Promise<void> {
    const displayName = normalizeDisplayName(value);
    const user = this.snapshot.user;
    if (!user || !displayName) {
      throw new Error("Enter a display name between 1 and 50 characters.");
    }
    const client = this.requireClient();
    const { error } = await client
      .from("profiles")
      .upsert({ id: user.id, display_name: displayName });
    if (error) throw new Error(error.message);

    const metadataResult = await client.auth.updateUser({ data: { display_name: displayName } });
    if (metadataResult.error) throw new Error(metadataResult.error.message);

    writeProfileCache(user.id, { displayName });
    await this.applySession(this.snapshot.session);
  }

  async signOut(): Promise<void> {
    this.recoveryActive = false;
    this.sessionApplication += 1;
    if (this.client) {
      const { error } = await this.client.auth.signOut({ scope: "local" });
      if (error) throw new Error(error.message);
    }
    this.emit({
      phase: "signedOut",
      configured: Boolean(this.client),
      session: null,
      user: null,
      profile: null,
    });
  }

  async deleteAccount(): Promise<string | null> {
    const userId = this.snapshot.user?.id ?? null;
    const client = this.requireClient();
    const { error } = await client.functions.invoke("delete-account", { method: "POST" });
    if (error) throw new Error(error.message);
    await client.auth.signOut({ scope: "local" });
    this.emit({
      phase: "signedOut",
      configured: Boolean(this.client),
      session: null,
      user: null,
      profile: null,
    });
    return userId;
  }

  dispose(): void {
    this.authSubscription?.unsubscribe();
    this.listeners.clear();
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error("Accounts are not configured in this build.");
    return this.client;
  }
}

export const authController = new AuthController();
