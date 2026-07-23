import type { Session, User } from "@supabase/supabase-js";
import {
  isAuthorizationFailure,
  isSupabaseConfigured,
  requireSupabase,
  supabase,
} from "./client";

export type AuthPhase = "loading" | "signedOut" | "signedIn" | "profileIncomplete" | "error";

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
  private snapshot: AuthSnapshot = { ...initialSnapshot };
  private listeners = new Set<AuthListener>();
  private initializePromise?: Promise<AuthSnapshot>;
  private authSubscription?: { unsubscribe(): void };

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
    if (!supabase) {
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      void this.applySession(session);
    });
    this.authSubscription = authListener.subscription;

    const { data, error } = await supabase.auth.getSession();
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

  private async applySession(session: Session | null): Promise<AuthSnapshot> {
    if (!session) {
      return this.emit({
        phase: "signedOut",
        configured: isSupabaseConfigured,
        session: null,
        user: null,
        profile: null,
      });
    }

    this.emit({
      phase: "loading",
      configured: true,
      session,
      user: session.user,
      profile: null,
    });

    const fallback = readProfileCache(session.user.id) ?? {
      displayName: normalizeDisplayName(session.user.user_metadata.display_name),
    };

    if (!navigator.onLine) {
      return this.emit({
        phase: fallback.displayName ? "signedIn" : "profileIncomplete",
        configured: true,
        session,
        user: session.user,
        profile: fallback,
      });
    }

    const client = requireSupabase();
    const { data, error, status } = await client
      .from("profiles")
      .select("display_name")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) {
      if (isAuthorizationFailure(error, status)) {
        await client.auth.signOut({ scope: "local" });
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

  async sendMagicLink(
    email: string,
    options: { createUser: boolean; displayName?: string; redirectTo: string },
  ): Promise<void> {
    const client = requireSupabase();
    const displayName = normalizeDisplayName(options.displayName);
    if (options.createUser && !displayName) {
      throw new Error("Enter a display name between 1 and 50 characters.");
    }
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: options.createUser,
        emailRedirectTo: options.redirectTo,
        data: options.createUser
          ? {
              display_name: displayName,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
              locale: navigator.language || "en-GB",
            }
          : undefined,
      },
    });
    if (error) throw new Error(error.message);
  }

  async updateDisplayName(value: string): Promise<void> {
    const displayName = normalizeDisplayName(value);
    const user = this.snapshot.user;
    if (!user || !displayName) {
      throw new Error("Enter a display name between 1 and 50 characters.");
    }
    const client = requireSupabase();
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
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw new Error(error.message);
    }
    this.emit({
      phase: "signedOut",
      configured: isSupabaseConfigured,
      session: null,
      user: null,
      profile: null,
    });
  }

  async deleteAccount(): Promise<string | null> {
    const userId = this.snapshot.user?.id ?? null;
    const client = requireSupabase();
    const { error } = await client.functions.invoke("delete-account", { method: "POST" });
    if (error) throw new Error(error.message);
    await client.auth.signOut({ scope: "local" });
    this.emit({
      phase: "signedOut",
      configured: isSupabaseConfigured,
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
}

export const authController = new AuthController();
