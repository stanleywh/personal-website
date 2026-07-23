import type { AuthSnapshot } from "../auth/session";
import { accountMode, accountUrl, navigateTo, safeNextPage } from "../auth/navigation";
import { validatePasswordConfirmation } from "../auth/password";
import { authController, profileCacheKey } from "../auth/session";

document.documentElement.classList.add("js");

const $ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const params = new URLSearchParams(window.location.search);
let mode = accountMode(params.get("mode"));
const nextPage = safeNextPage(params.get("next"));
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
const profileActions = $<HTMLElement>("[data-profile-actions]");
const legacyActions = $<HTMLElement>("[data-legacy-actions]");

function setMessage(value: string, error = false): void {
  message.textContent = value;
  message.dataset.tone = error ? "error" : "default";
}

function setMode(nextMode: typeof mode): void {
  mode = nextMode;
  const isSignup = mode === "signup";
  const isProfile = mode === "profile" || mode === "complete-profile";
  const isForgot = mode === "forgot-password";
  const isRecovery = mode === "recovery";
  const isLogin = mode === "login";

  title.textContent = isSignup
    ? "Create your account"
    : isProfile
      ? "Your profile"
      : isForgot
        ? "Reset your password"
        : isRecovery
          ? "Choose a new password"
          : "Welcome back";
  intro.textContent = isSignup
    ? "Choose a display name and password. Confirm your email before signing in."
    : isProfile
      ? "Update the display name shown on your homepage."
      : isForgot
        ? "Enter your email address and we’ll send password reset instructions."
        : isRecovery
          ? "Set a new password for the account authenticated by this recovery link."
          : "Enter your email address and password.";

  displayField.hidden = !isSignup && !isProfile;
  emailField.hidden = isProfile || isRecovery;
  passwordField.hidden = isProfile || isForgot;
  confirmPasswordField.hidden = !isSignup && !isRecovery;
  passwordHint.hidden = !isSignup && !isRecovery;
  forgot.hidden = !isLogin;
  loginHelp.hidden = !isLogin;
  loginReturn.hidden = !isForgot;
  tabs.hidden = isProfile || isForgot || isRecovery;
  profileActions.hidden = !isProfile;
  legacyActions.hidden = !isProfile;
  submit.textContent = isSignup
    ? "Create account"
    : isProfile
      ? "Save display name"
      : isForgot
        ? "Send reset instructions"
        : isRecovery
          ? "Update password"
          : "Log in";

  displayInput.required = isSignup || isProfile;
  emailInput.required = !isProfile && !isRecovery;
  passwordInput.required = isSignup || isRecovery || isLogin;
  confirmPasswordInput.required = isSignup || isRecovery;
  passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  for (const tab of tabs.querySelectorAll<HTMLElement>("[data-mode]")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.mode === mode));
  }
}

function validateNewPassword(): void {
  validatePasswordConfirmation(passwordInput.value, confirmPasswordInput.value);
}

function routeAuthenticated(auth: AuthSnapshot): void {
  if (auth.phase === "profileIncomplete") {
    mode = "complete-profile";
    displayInput.value = auth.profile?.displayName ?? "";
    setMode(mode);
    return;
  }
  navigateTo(nextPage, true);
}

tabs.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
  if (!target) return;
  const selected = accountMode(target.dataset.mode ?? null);
  setMode(selected);
  passwordInput.value = "";
  confirmPasswordInput.value = "";
  window.history.replaceState({}, "", accountUrl(selected, nextPage));
  setMessage("");
});

forgot.addEventListener("click", () => {
  setMode("forgot-password");
  window.history.replaceState({}, "", accountUrl("forgot-password", nextPage));
  setMessage("");
});

loginReturn.addEventListener("click", () => {
  setMode("login");
  window.history.replaceState({}, "", accountUrl("login", nextPage));
  setMessage("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submit.disabled = true;
  setMessage(mode === "profile" || mode === "complete-profile"
    ? "Saving…"
    : mode === "login"
      ? "Logging in…"
      : "Working…");
  try {
    if (mode === "profile" || mode === "complete-profile") {
      await authController.updateDisplayName(displayInput.value);
      setMessage("Display name saved.");
      window.setTimeout(() => navigateTo(nextPage, true), 450);
      return;
    }
    if (mode === "signup") {
      validateNewPassword();
      await authController.signUp(emailInput.value, passwordInput.value, {
        displayName: displayInput.value,
        redirectTo: accountUrl("callback", nextPage).toString(),
      });
      setMessage("Check your inbox to confirm your email address. If you already have an account, use Forgot password.");
      passwordInput.value = "";
      confirmPasswordInput.value = "";
      return;
    }
    if (mode === "forgot-password") {
      await authController.requestPasswordReset(
        emailInput.value,
        accountUrl("recovery", nextPage).toString(),
      );
      setMessage("If an account exists for that email, password reset instructions are on the way.");
      return;
    }
    if (mode === "recovery") {
      validateNewPassword();
      const auth = await authController.updatePassword(passwordInput.value);
      setMessage("Password updated.");
      window.setTimeout(() => routeAuthenticated(auth), 450);
      return;
    }
    const auth = await authController.signInWithPassword(emailInput.value, passwordInput.value);
    routeAuthenticated(auth);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "The request could not be completed.", true);
  } finally {
    submit.disabled = false;
  }
});

profileActions.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("[data-account-logout]")) {
    try {
      await authController.signOut();
      navigateTo("index.html", true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not log out.", true);
    }
  }
  if (target.closest("[data-account-delete]")) {
    if (!window.confirm("Permanently delete your account and all tracker data? This cannot be undone.")) return;
    try {
      const userId = await authController.deleteAccount();
      if (userId) {
        localStorage.removeItem(`revision-tracker:user:${userId}:state:v3`);
        localStorage.removeItem(`revision-tracker:user:${userId}:queue:v2`);
        localStorage.removeItem(profileCacheKey(userId));
        localStorage.removeItem(`revision-tracker:user:${userId}:legacy-dismissed:v1`);
        localStorage.removeItem(`revision-tracker:user:${userId}:legacy-import-pending:v1`);
      }
      navigateTo("index.html", true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account deletion failed.", true);
    }
  }
});

legacyActions.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("[data-legacy-import]")) navigateTo("tracker.html");
  if (target.closest("[data-legacy-delete]") && window.confirm("Delete the legacy browser data on this device?")) {
    localStorage.removeItem("revision-tracker:v2");
    localStorage.removeItem("revision-tracker:queue:v1");
    const userId = authController.state.user?.id;
    if (userId) localStorage.removeItem(`revision-tracker:user:${userId}:legacy-import-pending:v1`);
    setMessage("Legacy browser data deleted.");
  }
});

function reflectAuthState(auth: AuthSnapshot): void {
  if (auth.phase === "passwordRecovery") {
    mode = "recovery";
    setMode(mode);
    setMessage("");
    return;
  }
  if (auth.phase === "signedIn" || auth.phase === "profileIncomplete") {
    if (mode === "callback" && auth.phase === "signedIn") {
      navigateTo(nextPage, true);
    } else if (mode === "recovery") {
      mode = auth.phase === "profileIncomplete" ? "complete-profile" : "profile";
      displayInput.value = auth.profile?.displayName ?? "";
      setMode(mode);
      setMessage("Use a current password reset link to choose a new password.", true);
    } else {
      mode = auth.phase === "profileIncomplete" ? "complete-profile" : "profile";
      displayInput.value = auth.profile?.displayName ?? "";
      setMode(mode);
    }
  } else if (
    mode === "profile"
    || mode === "complete-profile"
    || mode === "callback"
    || mode === "recovery"
  ) {
    const requestedRecovery = mode === "recovery";
    mode = requestedRecovery ? "forgot-password" : "login";
    setMode(mode);
    if (requestedRecovery) {
      setMessage("Use the current link from your password reset email.", true);
    }
  }
  if (auth.phase === "error") {
    setMessage(auth.message ?? "The account service is unavailable.", true);
  }
}

setMode(mode);
authController.onChange(reflectAuthState);
reflectAuthState(await authController.initialize());

document.body.classList.add("is-ready");
