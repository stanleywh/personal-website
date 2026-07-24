export type AccountMode =
  | "login"
  | "signup"
  | "forgot-password"
  | "recovery"
  | "callback"
  | "profile"
  | "complete-profile";

export type PageName = "home" | "tracker" | "account";
export type ReturnPage = "home" | "tracker";

const pagePaths: Record<PageName, string> = {
  home: "/",
  tracker: "/tracker/",
  account: "/account/",
};

const allowedDestinations = new Set<ReturnPage>(["home", "tracker"]);

export function safeNextPage(
  value: string | null | undefined,
  fallback: ReturnPage = "home",
): ReturnPage {
  if (!value) return fallback;
  const candidate = value.split(/[?#]/, 1)[0];
  return allowedDestinations.has(candidate as ReturnPage)
    ? candidate as ReturnPage
    : fallback;
}

export function pageUrl(page: PageName): URL {
  return new URL(pagePaths[page], window.location.origin);
}

export function accountUrl(mode: AccountMode, next?: ReturnPage): URL {
  const url = pageUrl("account");
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

export function navigateTo(page: PageName, replace = false): void {
  const url = pageUrl(page);
  if (replace) window.location.replace(url);
  else window.location.assign(url);
}
