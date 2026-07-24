import { accountUrl } from "../auth/navigation";
import { authController } from "../auth/session";
import { TrackerAuthorizationError } from "./store";

const guard = document.querySelector<HTMLElement>("[data-tracker-guard]");
const guardMessage = document.querySelector<HTMLElement>("[data-tracker-guard-message]");

function showError(message: string): void {
  if (guardMessage) guardMessage.textContent = message;
  guard?.setAttribute("data-state", "error");
}

const auth = await authController.initialize();
if (auth.phase === "signedOut") {
  window.location.replace(accountUrl("login", "tracker"));
} else if (auth.phase === "profileIncomplete") {
  window.location.replace(accountUrl("complete-profile", "tracker"));
} else if (auth.phase === "signedIn") {
  try {
    await import("./main");
  } catch (error) {
    if (error instanceof TrackerAuthorizationError) {
      await authController.signOut();
      window.location.replace(accountUrl("login", "tracker"));
    } else {
      showError(error instanceof Error ? error.message : "The tracker could not be loaded.");
    }
  }
} else {
  showError(auth.message ?? "The account service is unavailable.");
}
