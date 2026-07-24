import type { AuthSnapshot } from "../auth/session";
import type {
  AccountMode,
  PageName,
  ReturnPage,
} from "../auth/navigation";
import { validatePasswordConfirmation } from "../auth/password";

export interface AccountAuth {
  readonly state: AuthSnapshot;
  onChange(listener: (snapshot: AuthSnapshot) => void): () => void;
  initialize(): Promise<AuthSnapshot>;
  signUp(
    email: string,
    password: string,
    options: { displayName?: string; redirectTo: string },
  ): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<AuthSnapshot>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  completePasswordRecovery(password: string): Promise<AuthSnapshot>;
  changePassword(password: string): Promise<void>;
  updateDisplayName(value: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<string | null>;
}

export interface AccountPageOptions {
  auth: AccountAuth;
  document: Document;
  window: Window;
  initialMode: AccountMode;
  nextPage: ReturnPage;
  accountUrl(mode: AccountMode, next?: ReturnPage): URL;
  navigateTo(page: PageName, replace?: boolean): void;
  profileCacheKey(userId: string): string;
}

export interface AccountPage {
  dispose(): void;
}

export async function initializeAccountPage(options: AccountPageOptions): Promise<AccountPage> {
  const {
    auth,
    document,
    window,
    nextPage,
    accountUrl,
    navigateTo,
    profileCacheKey,
  } = options;
  const $ = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  };

  let routeMode = options.initialMode;
  let mode = routeMode;
  let initialized = false;
  let recoveryVerified = false;
  let recoveryComplete = false;
  let profileUserId: string | null = null;

  const title = $<HTMLElement>("[data-account-title]");
  const intro = $<HTMLElement>("[data-account-intro]");
  const form = $<HTMLFormElement>("[data-account-form]");
  const displayField = $<HTMLElement>("[data-display-field]");
  const displayInput = $<HTMLInputElement>("[name=displayName]");
  const emailField = $<HTMLElement>("[data-email-field]");
  const emailInput = $<HTMLInputElement>("[name=email]");
  const passwordField = $<HTMLElement>("[data-password-field]");
  const passwordInput = $<HTMLInputElement>("[name=password]");
  const confirmPasswordField = $<HTMLElement>("[data-confirm-password-field]");
  const confirmPasswordInput = $<HTMLInputElement>("[name=confirmPassword]");
  const passwordHint = $<HTMLElement>("[data-password-hint]");
  const forgot = $<HTMLButtonElement>("[data-account-forgot]");
  const loginReturn = $<HTMLButtonElement>("[data-login-return]");
  const loginHelp = $<HTMLElement>("[data-login-help]");
  const submit = $<HTMLButtonElement>("[data-account-submit]");
  const message = $<HTMLElement>("[data-account-message]");
  const tabs = $<HTMLElement>("[data-account-tabs]");
  const profileSettings = $<HTMLElement>("[data-profile-settings]");
  const displayNameForm = $<HTMLFormElement>("[data-display-name-form]");
  const profileDisplayInput = $<HTMLInputElement>("[name=profileDisplayName]");
  const displayNameMessage = $<HTMLElement>("[data-display-name-message]");
  const changePasswordForm = $<HTMLFormElement>("[data-change-password-form]");
  const settingsPasswordInput = $<HTMLInputElement>("[name=settingsPassword]");
  const settingsConfirmPasswordInput = $<HTMLInputElement>("[name=settingsConfirmPassword]");
  const changePasswordMessage = $<HTMLElement>("[data-change-password-message]");
  const profileActions = $<HTMLElement>("[data-profile-actions]");
  const legacyActions = $<HTMLElement>("[data-legacy-actions]");
  const recoveryRetry = $<HTMLAnchorElement>("[data-recovery-retry]");
  const recoverySuccess = $<HTMLElement>("[data-recovery-success]");
  const recoveryLogin = $<HTMLAnchorElement>("[data-recovery-login]");

  function setMessage(
    target: HTMLElement,
    value: string,
    error = false,
  ): void {
    target.textContent = value;
    target.dataset.tone = error ? "error" : "default";
  }

  function setMode(nextMode: AccountMode): void {
    mode = nextMode;
    const isSignup = mode === "signup";
    const isProfile = mode === "profile";
    const isCompleteProfile = mode === "complete-profile";
    const isForgot = mode === "forgot-password";
    const isRecovery = mode === "recovery";
    const isLogin = mode === "login";

    title.textContent = isSignup
      ? "Create your account"
      : isProfile
        ? "Profile settings"
        : isCompleteProfile
          ? "Complete your profile"
          : isForgot
            ? "Reset your password"
            : isRecovery
              ? "Choose a new password"
              : mode === "callback"
                ? "Completing sign in"
                : "Welcome back";
    intro.textContent = isSignup
      ? "Choose a display name and password. Confirm your email before signing in."
      : isProfile
        ? "Update your display name or choose a new password."
        : isCompleteProfile
          ? "Choose the display name shown on your homepage before continuing."
          : isForgot
            ? "Enter your email address and we’ll send password reset instructions."
            : isRecovery
              ? "Set a new password for the account authenticated by this recovery link."
              : mode === "callback"
                ? "Checking your confirmed account…"
                : "Enter your email address and password.";

    form.hidden = isProfile;
    profileSettings.hidden = !isProfile;
    recoverySuccess.hidden = true;
    displayField.hidden = !isSignup && !isCompleteProfile;
    emailField.hidden = isCompleteProfile || isRecovery || mode === "callback";
    passwordField.hidden = isCompleteProfile || isForgot || mode === "callback";
    confirmPasswordField.hidden = !isSignup && !isRecovery;
    passwordHint.hidden = !isSignup && !isRecovery;
    forgot.hidden = !isLogin;
    loginHelp.hidden = !isLogin;
    loginReturn.hidden = !isForgot;
    tabs.hidden = isProfile || isCompleteProfile || isForgot || isRecovery || mode === "callback";
    recoveryRetry.hidden = true;

    submit.textContent = isSignup
      ? "Create account"
      : isCompleteProfile
        ? "Save display name"
        : isForgot
          ? "Send reset instructions"
          : isRecovery
            ? "Update password"
            : isLogin
              ? "Log in"
              : "Working…";
    displayInput.required = isSignup || isCompleteProfile;
    emailInput.required = isSignup || isForgot || isLogin;
    passwordInput.required = isSignup || isRecovery || isLogin;
    confirmPasswordInput.required = isSignup || isRecovery;
    passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
    submit.disabled = mode === "callback" || (isRecovery && !recoveryVerified);

    for (const tab of tabs.querySelectorAll<HTMLElement>("[data-mode]")) {
      tab.setAttribute("aria-pressed", String(tab.dataset.mode === mode));
    }
  }

  function replaceRoute(nextMode: AccountMode): void {
    routeMode = nextMode;
    setMode(nextMode);
    passwordInput.value = "";
    confirmPasswordInput.value = "";
    window.history.replaceState({}, "", accountUrl(nextMode, nextPage));
    setMessage(message, "");
  }

  function showProfile(authState: AuthSnapshot): void {
    setMode("profile");
    const userId = authState.user?.id ?? null;
    if (
      userId !== profileUserId
      || document.activeElement !== profileDisplayInput
    ) {
      profileDisplayInput.value = authState.profile?.displayName ?? "";
    }
    profileUserId = userId;
  }

  function showRecoveryComplete(): void {
    recoveryComplete = true;
    title.textContent = "Password updated";
    intro.textContent = "Your password has been changed successfully.";
    form.hidden = true;
    profileSettings.hidden = true;
    tabs.hidden = true;
    recoverySuccess.hidden = false;
    recoveryLogin.href = accountUrl("login", nextPage).toString();
    passwordInput.value = "";
    confirmPasswordInput.value = "";
    setMessage(message, "");
  }

  function showRecoveryState(authState: AuthSnapshot): void {
    setMode("recovery");
    recoveryVerified = authState.phase === "passwordRecovery";
    submit.disabled = !recoveryVerified;
    if (recoveryVerified) {
      setMessage(message, "");
      return;
    }
    if (authState.phase === "loading" && !initialized) {
      setMessage(message, "Verifying your recovery link…");
      return;
    }
    const authError = authState.phase === "error" ? authState.message : undefined;
    setMessage(
      message,
      authError ?? "This password reset link is invalid or has expired. Request a new one.",
      true,
    );
    recoveryRetry.href = accountUrl("forgot-password", nextPage).toString();
    recoveryRetry.hidden = false;
  }

  function reflectAuthState(authState: AuthSnapshot): void {
    if (recoveryComplete) return;

    if (routeMode === "recovery") {
      showRecoveryState(authState);
      return;
    }

    if (routeMode === "profile" && authState.phase === "error") {
      setMode("profile");
      setMessage(
        displayNameMessage,
        authState.message ?? "The account service is unavailable.",
        true,
      );
      return;
    }

    if (routeMode === "profile" && authState.user) {
      if (authState.phase === "profileIncomplete") {
        routeMode = "complete-profile";
        displayInput.value = authState.profile?.displayName ?? "";
        setMode(routeMode);
      } else if (
        authState.phase === "signedIn"
        || authState.phase === "passwordRecovery"
      ) {
        showProfile(authState);
      }
      return;
    }

    if (authState.phase === "signedIn" || authState.phase === "profileIncomplete") {
      if (routeMode === "callback" && authState.phase === "signedIn") {
        navigateTo(nextPage, true);
        return;
      }
      if (authState.phase === "profileIncomplete") {
        routeMode = "complete-profile";
        displayInput.value = authState.profile?.displayName ?? "";
        setMode(routeMode);
      } else {
        routeMode = "profile";
        showProfile(authState);
      }
      return;
    }

    if (authState.phase === "passwordRecovery" && authState.user) {
      routeMode = routeMode === "profile" ? "profile" : "login";
      if (routeMode === "profile") showProfile(authState);
      else setMode(routeMode);
      return;
    }

    if (
      authState.phase === "signedOut"
      && (
        routeMode === "profile"
        || routeMode === "complete-profile"
        || routeMode === "callback"
      )
    ) {
      routeMode = "login";
      setMode(routeMode);
      window.history.replaceState({}, "", accountUrl("login", nextPage));
    }

    if (authState.phase === "error") {
      setMessage(message, authState.message ?? "The account service is unavailable.", true);
    }
  }

  tabs.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (!target) return;
    replaceRoute(target.dataset.mode === "signup" ? "signup" : "login");
  });

  forgot.addEventListener("click", () => replaceRoute("forgot-password"));
  loginReturn.addEventListener("click", () => replaceRoute("login"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submittedMode = mode;
    submit.disabled = true;
    setMessage(
      message,
      submittedMode === "complete-profile"
        ? "Saving…"
        : submittedMode === "login"
          ? "Logging in…"
          : "Working…",
    );
    try {
      if (submittedMode === "complete-profile") {
        await auth.updateDisplayName(displayInput.value);
        setMessage(message, "Display name saved.");
        navigateTo(nextPage, true);
        return;
      }
      if (submittedMode === "signup") {
        validatePasswordConfirmation(passwordInput.value, confirmPasswordInput.value);
        await auth.signUp(emailInput.value, passwordInput.value, {
          displayName: displayInput.value,
          redirectTo: accountUrl("callback", nextPage).toString(),
        });
        setMessage(message, "Check your inbox to confirm your email address. If you already have an account, use Forgot password.");
        passwordInput.value = "";
        confirmPasswordInput.value = "";
        return;
      }
      if (submittedMode === "forgot-password") {
        await auth.requestPasswordReset(
          emailInput.value,
          accountUrl("recovery", nextPage).toString(),
        );
        setMessage(message, "If an account exists for that email, password reset instructions are on the way.");
        return;
      }
      if (submittedMode === "recovery") {
        if (!recoveryVerified) {
          throw new Error("Open a current password reset link before choosing a new password.");
        }
        validatePasswordConfirmation(passwordInput.value, confirmPasswordInput.value);
        await auth.completePasswordRecovery(passwordInput.value);
        recoveryComplete = true;
        try {
          await auth.signOut();
        } catch (error) {
          recoveryComplete = false;
          throw error;
        }
        showRecoveryComplete();
        return;
      }
      const authState = await auth.signInWithPassword(emailInput.value, passwordInput.value);
      if (authState.phase === "profileIncomplete") {
        routeMode = "complete-profile";
        displayInput.value = authState.profile?.displayName ?? "";
        setMode(routeMode);
      } else {
        navigateTo(nextPage, true);
      }
    } catch (error) {
      setMessage(message, error instanceof Error ? error.message : "The request could not be completed.", true);
    } finally {
      if (!recoveryComplete) {
        submit.disabled = mode === "callback" || (mode === "recovery" && !recoveryVerified);
      }
    }
  });

  displayNameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!displayNameForm.reportValidity()) return;
    const button = $<HTMLButtonElement>("[data-save-display-name]");
    button.disabled = true;
    setMessage(displayNameMessage, "Saving…");
    try {
      await auth.updateDisplayName(profileDisplayInput.value);
      setMessage(displayNameMessage, "Display name saved.");
    } catch (error) {
      setMessage(displayNameMessage, error instanceof Error ? error.message : "Display name could not be saved.", true);
    } finally {
      button.disabled = false;
    }
  });

  changePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!changePasswordForm.reportValidity()) return;
    const button = $<HTMLButtonElement>("[data-change-password]");
    button.disabled = true;
    setMessage(changePasswordMessage, "Changing password…");
    try {
      validatePasswordConfirmation(
        settingsPasswordInput.value,
        settingsConfirmPasswordInput.value,
      );
      await auth.changePassword(settingsPasswordInput.value);
      settingsPasswordInput.value = "";
      settingsConfirmPasswordInput.value = "";
      setMessage(changePasswordMessage, "Password changed.");
    } catch (error) {
      setMessage(changePasswordMessage, error instanceof Error ? error.message : "Password could not be changed.", true);
    } finally {
      button.disabled = false;
    }
  });

  profileActions.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-account-logout]")) {
      try {
        await auth.signOut();
        navigateTo("home", true);
      } catch (error) {
        setMessage(displayNameMessage, error instanceof Error ? error.message : "Could not log out.", true);
      }
    }
    if (target.closest("[data-account-delete]")) {
      if (!window.confirm("Permanently delete your account and all tracker data? This cannot be undone.")) return;
      try {
        const userId = await auth.deleteAccount();
        if (userId) {
          window.localStorage.removeItem(`revision-tracker:user:${userId}:state:v3`);
          window.localStorage.removeItem(`revision-tracker:user:${userId}:queue:v2`);
          window.localStorage.removeItem(profileCacheKey(userId));
          window.localStorage.removeItem(`revision-tracker:user:${userId}:legacy-dismissed:v1`);
          window.localStorage.removeItem(`revision-tracker:user:${userId}:legacy-import-pending:v1`);
        }
        navigateTo("home", true);
      } catch (error) {
        setMessage(displayNameMessage, error instanceof Error ? error.message : "Account deletion failed.", true);
      }
    }
  });

  legacyActions.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-legacy-import]")) navigateTo("tracker");
    if (
      target.closest("[data-legacy-delete]")
      && window.confirm("Delete the legacy browser data on this device?")
    ) {
      window.localStorage.removeItem("revision-tracker:v2");
      window.localStorage.removeItem("revision-tracker:queue:v1");
      const userId = auth.state.user?.id;
      if (userId) {
        window.localStorage.removeItem(`revision-tracker:user:${userId}:legacy-import-pending:v1`);
      }
      setMessage(displayNameMessage, "Legacy browser data deleted.");
    }
  });

  setMode(routeMode);
  if (routeMode === "recovery") {
    setMessage(message, "Verifying your recovery link…");
  }
  const unsubscribe = auth.onChange(reflectAuthState);
  const initialAuth = await auth.initialize();
  initialized = true;
  reflectAuthState(initialAuth);
  document.body.classList.add("is-ready");

  return {
    dispose(): void {
      unsubscribe();
    },
  };
}
