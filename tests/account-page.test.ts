import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Session, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountUrl, type AccountMode } from "../src/auth/navigation";
import type { AuthSnapshot } from "../src/auth/session";
import { profileCacheKey } from "../src/auth/session";
import {
  initializeAccountPage,
  type AccountAuth,
} from "../src/account/page";

const accountHtml = readFileSync(resolve(process.cwd(), "account/index.html"), "utf8");
const user = {
  id: "user-1",
  email: "user@example.com",
  app_metadata: {},
  user_metadata: { display_name: "Stanley" },
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
} as User;
const session = { user } as Session;

function authSnapshot(phase: AuthSnapshot["phase"]): AuthSnapshot {
  const authenticated = phase === "signedIn"
    || phase === "profileIncomplete"
    || phase === "passwordRecovery"
    || phase === "loading";
  return {
    phase,
    configured: true,
    session: authenticated ? session : null,
    user: authenticated ? user : null,
    profile: authenticated ? { displayName: "Stanley" } : null,
  };
}

class FakeAuth implements AccountAuth {
  state: AuthSnapshot;
  private listeners = new Set<(snapshot: AuthSnapshot) => void>();

  initialize = vi.fn(async () => this.state);
  signUp = vi.fn(async () => undefined);
  signInWithPassword = vi.fn(async () => authSnapshot("signedIn"));
  requestPasswordReset = vi.fn(async () => undefined);
  completePasswordRecovery = vi.fn(async () => authSnapshot("signedIn"));
  changePassword = vi.fn(async () => undefined);
  updateDisplayName = vi.fn(async () => undefined);
  signOut = vi.fn(async () => undefined);
  deleteAccount = vi.fn(async () => "user-1");

  constructor(initial: AuthSnapshot) {
    this.state = initial;
  }

  onChange(listener: (snapshot: AuthSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(snapshot: AuthSnapshot): void {
    this.state = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

async function mount(mode: AccountMode, initial: AuthSnapshot) {
  const parsed = new DOMParser().parseFromString(accountHtml, "text/html");
  document.body.className = parsed.body.className;
  document.body.innerHTML = parsed.body.innerHTML;
  window.history.replaceState({}, "", `/account/?mode=${mode}&next=tracker`);
  const auth = new FakeAuth(initial);
  const navigateTo = vi.fn();
  const page = await initializeAccountPage({
    auth,
    document,
    window,
    initialMode: mode,
    nextPage: "tracker",
    accountUrl,
    navigateTo,
    profileCacheKey,
  });
  return { auth, navigateTo, page };
}

function submit(selector: string): void {
  const form = document.querySelector<HTMLFormElement>(selector);
  if (!form) throw new Error(`Missing test form: ${selector}`);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("account page modes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens recovery directly on password controls and survives auth-state changes", async () => {
    const { auth, navigateTo } = await mount("recovery", authSnapshot("passwordRecovery"));

    expect(document.querySelector<HTMLElement>("[data-display-field]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-password-field]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-confirm-password-field]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-profile-settings]")?.hidden).toBe(true);

    auth.emit(authSnapshot("signedIn"));
    expect(document.querySelector<HTMLElement>("[data-display-field]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-password-field]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-confirm-password-field]")?.hidden).toBe(false);
    expect(navigateTo).not.toHaveBeenCalled();

    auth.emit(authSnapshot("passwordRecovery"));
    expect(document.querySelector<HTMLButtonElement>("[data-account-submit]")?.disabled).toBe(false);
  });

  it("keeps normal profile settings out of recovery mode and shows both controls", async () => {
    const { auth } = await mount("profile", authSnapshot("signedIn"));

    expect(document.querySelector<HTMLFormElement>("[data-account-form]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-profile-settings]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>("[name=profileDisplayName]")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("[name=settingsPassword]")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("[name=settingsConfirmPassword]")).not.toBeNull();

    auth.emit(authSnapshot("passwordRecovery"));

    expect(document.querySelector<HTMLElement>("[data-profile-settings]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLFormElement>("[data-account-form]")?.hidden).toBe(true);
  });

  it("saves display name and password independently without leaving settings", async () => {
    const { auth, navigateTo } = await mount("profile", authSnapshot("signedIn"));
    const displayName = document.querySelector<HTMLInputElement>("[name=profileDisplayName]")!;
    displayName.value = "New Stanley";

    submit("[data-display-name-form]");
    await vi.waitFor(() => expect(auth.updateDisplayName).toHaveBeenCalledWith("New Stanley"));
    expect(document.querySelector("[data-display-name-message]")?.textContent).toBe("Display name saved.");
    expect(navigateTo).not.toHaveBeenCalled();

    const password = document.querySelector<HTMLInputElement>("[name=settingsPassword]")!;
    const confirmation = document.querySelector<HTMLInputElement>("[name=settingsConfirmPassword]")!;
    password.value = "ChangedNow2!";
    confirmation.value = "ChangedNow2!";

    submit("[data-change-password-form]");
    await vi.waitFor(() => expect(auth.changePassword).toHaveBeenCalledWith("ChangedNow2!"));
    expect(document.querySelector("[data-change-password-message]")?.textContent).toBe("Password changed.");
    expect(password.value).toBe("");
    expect(confirmation.value).toBe("");
    auth.emit(authSnapshot("signedIn"));
    expect(document.querySelector("[data-display-name-message]")?.textContent).toBe("Display name saved.");
    expect(document.querySelector("[data-change-password-message]")?.textContent).toBe("Password changed.");
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("does not redirect during recovery and requires an explicit return to login", async () => {
    const { auth, navigateTo } = await mount("recovery", authSnapshot("passwordRecovery"));
    const password = document.querySelector<HTMLInputElement>("[name=password]")!;
    const confirmation = document.querySelector<HTMLInputElement>("[name=confirmPassword]")!;
    password.value = "ChangedNow2!";
    confirmation.value = "ChangedNow2!";

    expect(navigateTo).not.toHaveBeenCalled();
    submit("[data-account-form]");

    await vi.waitFor(() => expect(auth.completePasswordRecovery).toHaveBeenCalledWith("ChangedNow2!"));
    await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    expect(document.querySelector<HTMLElement>("[data-recovery-success]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLFormElement>("[data-account-form]")?.hidden).toBe(true);
    expect(navigateTo).not.toHaveBeenCalled();

    const loginUrl = new URL(
      document.querySelector<HTMLAnchorElement>("[data-recovery-login]")!.href,
    );
    expect(loginUrl.searchParams.get("mode")).toBe("login");
    expect(loginUrl.searchParams.get("next")).toBe("tracker");
  });

  it("keeps an invalid recovery request in recovery UI with a retry link", async () => {
    await mount("recovery", authSnapshot("signedOut"));

    expect(document.querySelector<HTMLElement>("[data-display-field]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-password-field]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("[data-account-submit]")?.disabled).toBe(true);
    expect(document.querySelector<HTMLAnchorElement>("[data-recovery-retry]")?.hidden).toBe(false);
  });

  it("keeps incomplete-profile onboarding separate and continues after saving", async () => {
    const { auth, navigateTo } = await mount(
      "complete-profile",
      authSnapshot("profileIncomplete"),
    );
    const displayName = document.querySelector<HTMLInputElement>("[name=displayName]")!;
    displayName.value = "Stanley";

    expect(document.querySelector<HTMLElement>("[data-profile-settings]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-display-field]")?.hidden).toBe(false);
    submit("[data-account-form]");

    await vi.waitFor(() => expect(auth.updateDisplayName).toHaveBeenCalledWith("Stanley"));
    expect(navigateTo).toHaveBeenCalledWith("tracker", true);
  });
});
