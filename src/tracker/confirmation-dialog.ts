export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => Promise<void> | void;
  trigger?: HTMLElement | null;
  successFocus?: HTMLElement | null;
}

export interface ConfirmationDialogController {
  open(request: ConfirmationRequest): void;
}

interface ConfirmationDialogElements {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  message: HTMLElement;
  error: HTMLElement;
  cancel: HTMLButtonElement;
  confirm: HTMLButtonElement;
}

export function createConfirmationDialog(
  elements: ConfirmationDialogElements,
): ConfirmationDialogController {
  let activeRequest: ConfirmationRequest | undefined;
  let pending = false;
  let returnFocus: HTMLElement | null = null;
  let actionConfirmed = false;

  function setPending(value: boolean): void {
    pending = value;
    elements.dialog.setAttribute("aria-busy", String(value));
    elements.cancel.disabled = value;
    elements.confirm.disabled = value;
  }

  function close(): void {
    if (elements.dialog.open) elements.dialog.close("cancel");
  }

  elements.cancel.addEventListener("click", (event) => {
    event.preventDefault();
    if (!pending) close();
  });

  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!pending) close();
  });

  elements.dialog.addEventListener("close", () => {
    setPending(false);
    const request = activeRequest;
    const target = actionConfirmed ? request?.successFocus ?? returnFocus : returnFocus;
    activeRequest = undefined;
    actionConfirmed = false;
    returnFocus = null;
    const parentDialog = target?.closest("dialog");
    if (target?.isConnected && (!parentDialog || parentDialog.open)) target.focus();
  });

  elements.confirm.addEventListener("click", async (event) => {
    event.preventDefault();
    if (pending || !activeRequest) return;

    setPending(true);
    elements.error.textContent = "";
    try {
      await activeRequest.action();
      actionConfirmed = true;
      if (elements.dialog.open) elements.dialog.close("confirmed");
    } catch (error) {
      elements.error.textContent = error instanceof Error
        ? error.message
        : "This action could not be completed.";
      setPending(false);
      elements.confirm.focus();
    }
  });

  return {
    open(request): void {
      activeRequest = request;
      actionConfirmed = false;
      returnFocus = request.trigger
        ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      elements.title.textContent = request.title;
      elements.message.textContent = request.message;
      elements.confirm.textContent = request.confirmLabel;
      elements.error.textContent = "";
      setPending(false);
      elements.dialog.showModal();
      queueMicrotask(() => elements.cancel.focus());
    },
  };
}
