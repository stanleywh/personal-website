import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "../src/auth/session";

const session = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "user-1",
    app_metadata: {},
    user_metadata: { display_name: "Stanley" },
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  },
} as Session;

function clientDouble(initialSession: Session | null = null) {
  let authCallback: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
  const profileQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { display_name: "Stanley" },
      error: null,
      status: 200,
    }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  const auth = {
    onAuthStateChange: vi.fn((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    getSession: vi.fn().mockResolvedValue({
      data: { session: initialSession },
      error: null,
    }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null, user: session.user }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session, user: session.user }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: session.user }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  const client = {
    auth,
    from: vi.fn().mockReturnValue(profileQuery),
    functions: { invoke: vi.fn().mockResolvedValue({ error: null }) },
  } as unknown as SupabaseClient;
  return { client, auth, emit: (event: AuthChangeEvent, next: Session | null) => authCallback?.(event, next) };
}

describe("password authentication requests", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("signs up with the existing profile metadata and confirmation redirect", async () => {
    const fake = clientDouble();
    const controller = new AuthController(fake.client);
    await controller.signUp("  user@example.com ", "StudyNow1!", {
      displayName: " Stanley ",
      redirectTo: "https://example.test/account.html?mode=callback",
    });

    expect(fake.auth.signUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "StudyNow1!",
      options: {
        emailRedirectTo: "https://example.test/account.html?mode=callback",
        data: expect.objectContaining({
          display_name: "Stanley",
          locale: expect.any(String),
          timezone: expect.any(String),
        }),
      },
    });
  });

  it("uses password login without calling an email authentication method", async () => {
    const fake = clientDouble();
    const controller = new AuthController(fake.client);
    await controller.signInWithPassword(" user@example.com ", "StudyNow1!");

    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "StudyNow1!",
    });
    expect(fake.auth.signUp).not.toHaveBeenCalled();
    expect(fake.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("requests recovery with the exact supplied allow-listed URL", async () => {
    const fake = clientDouble();
    const controller = new AuthController(fake.client);
    const redirectTo = "https://example.test/account.html?mode=recovery&next=tracker.html";
    await controller.requestPasswordReset(" user@example.com ", redirectTo);

    expect(fake.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.com",
      { redirectTo },
    );
  });
});

describe("password recovery session", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.history.replaceState({}, "", "/account.html");
  });

  it("prioritizes PASSWORD_RECOVERY and only then allows updateUser", async () => {
    const fake = clientDouble(null);
    const controller = new AuthController(fake.client);
    await controller.initialize();

    await expect(controller.updatePassword("StudyNow1!")).rejects.toThrow(
      "Open a current password reset link",
    );

    fake.emit("PASSWORD_RECOVERY", session);
    await vi.waitFor(() => expect(controller.state.phase).toBe("passwordRecovery"));

    fake.auth.getSession.mockResolvedValueOnce({ data: { session }, error: null });
    const updated = await controller.updatePassword("ChangedNow2!");
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: "ChangedNow2!" });
    expect(updated.phase).toBe("signedIn");
  });

  it("does not let a later INITIAL_SESSION overwrite recovery mode", async () => {
    const fake = clientDouble(null);
    const controller = new AuthController(fake.client);
    await controller.initialize();

    fake.emit("PASSWORD_RECOVERY", session);
    fake.emit("INITIAL_SESSION", session);
    await vi.waitFor(() => expect(controller.state.phase).toBe("passwordRecovery"));
  });

  it("scrubs malformed callback fragments without treating them as recovery proof", async () => {
    const fake = clientDouble(null);
    const controller = new AuthController(fake.client);
    window.history.replaceState({}, "", "/account.html?mode=recovery#type=recovery&bad_token=1");

    const initialized = await controller.initialize();

    expect(initialized.phase).toBe("signedOut");
    expect(window.location.hash).toBe("");
  });
});

describe("preserved account lifecycle behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.history.replaceState({}, "", "/account.html");
  });

  it("restores a persistent session and loads its existing profile", async () => {
    const fake = clientDouble(session);
    const controller = new AuthController(fake.client);

    const restored = await controller.initialize();

    expect(restored.phase).toBe("signedIn");
    expect(restored.user?.id).toBe("user-1");
    expect(fake.client.from).toHaveBeenCalledWith("profiles");
  });

  it("retains local-scope logout behavior", async () => {
    const fake = clientDouble(session);
    const controller = new AuthController(fake.client);
    await controller.initialize();

    await controller.signOut();

    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(controller.state.phase).toBe("signedOut");
  });

  it("retains account deletion and returns the user ID for local cleanup", async () => {
    const fake = clientDouble(session);
    const controller = new AuthController(fake.client);
    await controller.initialize();

    await expect(controller.deleteAccount()).resolves.toBe("user-1");
    expect(fake.client.functions.invoke).toHaveBeenCalledWith(
      "delete-account",
      { method: "POST" },
    );
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
