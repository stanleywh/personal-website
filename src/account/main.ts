import { accountMode, accountUrl, navigateTo, safeNextPage } from "../auth/navigation";
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
const submit = $<HTMLButtonElement>("[data-account-submit]");
const message = $<HTMLElement>("[data-account-message]");
const tabs = $<HTMLElement>("[data-account-tabs]");
const profileActions = $<HTMLElement>("[data-profile-actions]");
const legacyActions = $<HTMLElement>("[data-legacy-actions]");
let cooldownTimer: number | undefined;

function setMessage(value: string, error = false): void {
  message.textContent = value;
  message.dataset.tone = error ? "error" : "default";
}

function setMode(nextMode: typeof mode): void {
  mode = nextMode;
  const isSignup = mode === "signup";
  const isProfile = mode === "profile" || mode === "complete-profile";
  title.textContent = isSignup ? "Create your account" : isProfile ? "Your profile" : "Welcome back";
  intro.textContent = isSignup
    ? "Choose the name shown on your homepage, then we’ll email you a secure sign-up link."
    : isProfile
      ? "Update the display name shown on your homepage."
      : "Enter your email and we’ll send a one-time sign-in link.";
  displayField.hidden = !isSignup && !isProfile;
  emailField.hidden = isProfile;
  tabs.hidden = isProfile;
  profileActions.hidden = !isProfile;
  legacyActions.hidden = !isProfile;
  submit.textContent = isSignup ? "Email me a sign-up link" : isProfile ? "Save display name" : "Email me a login link";
  displayInput.required = isSignup || isProfile;
  emailInput.required = !isProfile;
  for (const tab of tabs.querySelectorAll<HTMLElement>("[data-mode]")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.mode === mode));
  }
}

function startCooldown(): void {
  window.clearInterval(cooldownTimer);
  let remaining = 60;
  submit.disabled = true;
  submit.textContent = `Try again in ${remaining}s`;
  cooldownTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(cooldownTimer);
      submit.disabled = false;
      setMode(mode);
    } else {
      submit.textContent = `Try again in ${remaining}s`;
    }
  }, 1_000);
}

tabs.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
  if (!target) return;
  const selected = accountMode(target.dataset.mode ?? null);
  setMode(selected);
  window.history.replaceState({}, "", accountUrl(selected, nextPage));
  setMessage("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submit.disabled = true;
  setMessage(mode === "profile" || mode === "complete-profile" ? "Saving…" : "Sending…");
  try {
    if (mode === "profile" || mode === "complete-profile") {
      await authController.updateDisplayName(displayInput.value);
      setMessage("Display name saved.");
      window.setTimeout(() => navigateTo(nextPage, true), 450);
      return;
    }
    const callback = accountUrl("callback", nextPage);
    await authController.sendMagicLink(emailInput.value, {
      createUser: mode === "signup",
      displayName: displayInput.value,
      redirectTo: callback.toString(),
    });
    setMessage("Check your inbox. The link can be used once and expires in one hour.");
    startCooldown();
  } catch (error) {
    submit.disabled = false;
    setMessage(error instanceof Error ? error.message : "The request could not be completed.", true);
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

setMode(mode);
const auth = await authController.initialize();
if (auth.phase === "signedIn" || auth.phase === "profileIncomplete") {
  if (mode === "callback" && auth.phase === "signedIn") {
    navigateTo(nextPage, true);
  } else {
    mode = auth.phase === "profileIncomplete" ? "complete-profile" : "profile";
    displayInput.value = auth.profile?.displayName ?? "";
    setMode(mode);
  }
} else if (mode === "profile" || mode === "complete-profile") {
  mode = "login";
  setMode(mode);
} else if (auth.phase === "error") {
  setMessage(auth.message ?? "The account service is unavailable.", true);
}

document.body.classList.add("is-ready");
