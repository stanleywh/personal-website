import { accountUrl } from "../auth/navigation";
import { authController } from "../auth/session";
import { createTrackerAuthGate } from "./auth-gate";
import { TrackerAuthorizationError } from "./store";

const guard = document.querySelector<HTMLElement>("[data-tracker-guard]");
const guardMessage = document.querySelector<HTMLElement>("[data-tracker-guard-message]");

if (!guard || !guardMessage) {
  throw new Error("The tracker account gate could not be initialized.");
}

const authGate = createTrackerAuthGate({ guard, message: guardMessage });

try {
  const auth = await authController.initialize();
  if (auth.phase === "signedOut") {
    authGate.finish();
    window.location.replace(accountUrl("login", "tracker"));
  } else if (auth.phase === "profileIncomplete") {
    authGate.finish();
    window.location.replace(accountUrl("complete-profile", "tracker"));
  } else if (auth.phase === "signedIn") {
    try {
      await import("./main");
      authGate.finish();
    } catch (error) {
      if (error instanceof TrackerAuthorizationError) {
        try {
          await authController.signOut();
        } finally {
          authGate.finish();
          window.location.replace(accountUrl("login", "tracker"));
        }
      } else {
        authGate.showError(error instanceof Error ? error.message : "The tracker could not be loaded.");
      }
    }
  } else {
    authGate.showError(auth.message ?? "The account service is unavailable.");
  }
} catch (error) {
  authGate.showError(error instanceof Error ? error.message : "The account service is unavailable.");
}
