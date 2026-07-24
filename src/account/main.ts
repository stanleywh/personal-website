import { accountMode, accountUrl, navigateTo, safeNextPage } from "../auth/navigation";
import { authController, profileCacheKey } from "../auth/session";
import { initializeAccountPage } from "./page";

document.documentElement.classList.add("js");

const params = new URLSearchParams(window.location.search);
await initializeAccountPage({
  auth: authController,
  document,
  window,
  initialMode: accountMode(params.get("mode")),
  nextPage: safeNextPage(params.get("next")),
  accountUrl,
  navigateTo,
  profileCacheKey,
});
