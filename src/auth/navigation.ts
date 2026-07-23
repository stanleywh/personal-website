export type AccountMode =
  | "login"
  | "signup"
  | "forgot-password"
  | "recovery"
  | "callback"
  | "profile"
  | "complete-profile";

const allowedDestinations = new Set(["index.html", "tracker.html", "account.html"]);

export function safeNextPage(value: string | null | undefined, fallback = "index.html"): string {
  if (!value) return fallback;
  const candidate = value.replace(/^\.?\//, "").split(/[?#]/, 1)[0];
  return allowedDestinations.has(candidate) ? candidate : fallback;
}

export function pageUrl(page: string): URL {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}${safeNextPage(page)}`, window.location.origin);
}

export function accountUrl(mode: AccountMode, next?: string): URL {
  const url = pageUrl("account.html");
  url.searchParams.set("mode", mode);
  if (next) url.searchParams.set("next", safeNextPage(next));
  return url;
}

export function accountMode(value: string | null): AccountMode {
  return value === "signup"
    || value === "forgot-password"
    || value === "recovery"
    || value === "callback"
    || value === "profile"
    || value === "complete-profile"
    ? value
    : "login";
}

export function navigateTo(page: string, replace = false): void {
  const url = pageUrl(page);
  if (replace) window.location.replace(url);
  else window.location.assign(url);
}
