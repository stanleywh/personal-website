const MORE_LINK_SELECTOR = ".fc-more-link";
const POPOVER_SELECTOR = ".fc-more-popover";
const POPOVER_BODY_SELECTOR = ".fc-popover-body";
const POPOVER_HEADER_SELECTOR = ".fc-popover-header";
const NATIVE_CLOSE_SELECTOR = ".fc-popover-close";
const ENHANCED_CLOSE_SELECTOR = "[data-calendar-popover-close]";
const VIEWPORT_PADDING = 10;
const MIN_BODY_HEIGHT = 96;

function scheduleFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 0);
}

function cancelFrame(handle: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle);
  } else {
    window.clearTimeout(handle);
  }
}

function addAccessibleCloseButton(popover: HTMLElement): void {
  if (popover.querySelector(ENHANCED_CLOSE_SELECTOR)) return;

  const nativeClose = popover.querySelector<HTMLElement>(NATIVE_CLOSE_SELECTOR);
  if (!nativeClose) return;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "icon-button calendar-popover__close";
  closeButton.dataset.calendarPopoverClose = "";
  closeButton.setAttribute("aria-label", nativeClose.title || "Close");
  closeButton.textContent = "\u00d7";
  closeButton.addEventListener("click", () => nativeClose.click());

  nativeClose.hidden = true;
  nativeClose.setAttribute("aria-hidden", "true");
  nativeClose.before(closeButton);
}

function fitPopoverToViewport(popover: HTMLElement): void {
  const header = popover.querySelector<HTMLElement>(POPOVER_HEADER_SELECTOR);
  const body = popover.querySelector<HTMLElement>(POPOVER_BODY_SELECTOR);
  if (!header || !body) return;

  if (!popover.dataset.calendarPopoverAnchorTop) {
    popover.dataset.calendarPopoverAnchorTop = popover.style.top;
  }
  popover.style.top = popover.dataset.calendarPopoverAnchorTop;

  const initialRect = popover.getBoundingClientRect();
  const headerHeight = header.getBoundingClientRect().height;
  const availableBodyHeight = Math.max(
    MIN_BODY_HEIGHT,
    Math.floor(window.innerHeight - initialRect.top - headerHeight - VIEWPORT_PADDING),
  );
  body.style.setProperty(
    "--calendar-popover-available-height",
    `${availableBodyHeight}px`,
  );

  const fittedRect = popover.getBoundingClientRect();
  const viewportOverflow = fittedRect.bottom - (window.innerHeight - VIEWPORT_PADDING);
  const inlineTop = Number.parseFloat(popover.style.top);
  if (viewportOverflow > 0 && Number.isFinite(inlineTop)) {
    const availableShift = Math.max(0, fittedRect.top - VIEWPORT_PADDING);
    const shift = Math.min(viewportOverflow, availableShift);
    popover.style.top = `${inlineTop - shift}px`;
  }

  const isBodyOverflowing = body.scrollHeight > body.clientHeight + 1;
  if (isBodyOverflowing) {
    const title = popover
      .querySelector<HTMLElement>(".fc-popover-title")
      ?.textContent?.trim();
    body.tabIndex = 0;
    body.setAttribute("role", "region");
    body.setAttribute(
      "aria-label",
      title ? `Events on ${title}` : "More calendar events",
    );
  } else {
    body.removeAttribute("tabindex");
    body.removeAttribute("role");
    body.removeAttribute("aria-label");
  }
}

export function enhanceOpenCalendarPopover(root: HTMLElement): HTMLElement | null {
  const popover = root.querySelector<HTMLElement>(POPOVER_SELECTOR);
  if (!popover) return null;

  addAccessibleCloseButton(popover);
  fitPopoverToViewport(popover);
  return popover;
}

export function attachCalendarPopoverEnhancements(root: HTMLElement): () => void {
  let pendingFrame: number | undefined;

  const scheduleEnhancement = (): void => {
    if (pendingFrame !== undefined) cancelFrame(pendingFrame);
    pendingFrame = scheduleFrame(() => {
      pendingFrame = undefined;
      enhanceOpenCalendarPopover(root);
    });
  };

  const observer = new MutationObserver((mutations) => {
    const popoverWasAdded = mutations.some((mutation) =>
      [...mutation.addedNodes].some(
        (node) =>
          node instanceof Element
          && (node.matches(POPOVER_SELECTOR)
            || Boolean(node.querySelector(POPOVER_SELECTOR))),
      ),
    );
    if (popoverWasAdded) scheduleEnhancement();
  });

  const handleMoreLinkClick = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest(MORE_LINK_SELECTOR)) {
      scheduleEnhancement();
    }
  };

  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("click", handleMoreLinkClick, true);
  window.addEventListener("resize", scheduleEnhancement);
  if (root.querySelector(POPOVER_SELECTOR)) scheduleEnhancement();

  return () => {
    observer.disconnect();
    root.removeEventListener("click", handleMoreLinkClick, true);
    window.removeEventListener("resize", scheduleEnhancement);
    if (pendingFrame !== undefined) cancelFrame(pendingFrame);
  };
}
