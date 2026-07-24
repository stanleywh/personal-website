import { accountUrl, navigateTo } from "../auth/navigation";
import { authController } from "../auth/session";

document.documentElement.classList.add("js");

const home = document.querySelector<HTMLElement>(".home");
const year = document.querySelector<HTMLElement>("[data-year]");
const heading = document.querySelector<HTMLElement>("[data-home-heading]");
const account = document.querySelector<HTMLElement>("[data-home-account]");
const trackerLink = document.querySelector<HTMLAnchorElement>("[data-tracker-link]");

if (year) year.textContent = new Date().getFullYear().toString();

function renderSignedOut(message?: string): void {
  if (heading) heading.textContent = "Stanley";
  if (account) {
    const login = document.createElement("a");
    login.className = "home-account__link";
    login.href = accountUrl("login", "home").toString();
    login.textContent = "Log in";
    const signup = document.createElement("a");
    signup.className = "home-account__link home-account__link--primary";
    signup.href = accountUrl("signup", "home").toString();
    signup.textContent = "Sign up";
    account.replaceChildren(login, signup);
    if (message) {
      const status = document.createElement("span");
      status.className = "home-account__message";
      status.textContent = message;
      account.append(status);
    }
  }
}

function renderSignedIn(displayName: string): void {
  if (heading) heading.textContent = displayName;
  if (account) {
    const profile = document.createElement("a");
    profile.className = "home-account__link";
    profile.href = accountUrl("profile", "home").toString();
    profile.textContent = "Profile";
    const logout = document.createElement("button");
    logout.className = "home-account__link";
    logout.type = "button";
    logout.textContent = "Log out";
    account.replaceChildren(profile, logout);
    logout.addEventListener("click", async () => {
      try {
        await authController.signOut();
        renderSignedOut();
      } catch (error) {
        renderSignedOut(error instanceof Error ? error.message : "Could not log out.");
      }
    });
  }
}

trackerLink?.addEventListener("click", (event) => {
  if (authController.state.phase !== "signedIn") {
    event.preventDefault();
    window.location.assign(accountUrl("login", "tracker"));
  }
});

const auth = await authController.initialize();
if (auth.phase === "profileIncomplete") {
  window.location.replace(accountUrl("complete-profile", "home"));
} else if (auth.phase === "signedIn" && auth.profile?.displayName) {
  renderSignedIn(auth.profile.displayName);
} else {
  renderSignedOut(auth.phase === "error" ? auth.message : undefined);
}

home?.setAttribute("data-auth-ready", "true");
document.querySelector(".home__hero")?.removeAttribute("aria-busy");
requestAnimationFrame(() => requestAnimationFrame(() => home?.classList.add("is-ready")));

authController.onChange((next) => {
  if (next.phase === "signedOut") renderSignedOut();
  if (next.phase === "signedIn" && next.profile?.displayName) renderSignedIn(next.profile.displayName);
  if (next.phase === "profileIncomplete") navigateTo("account");
});
