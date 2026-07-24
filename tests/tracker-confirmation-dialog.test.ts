import { describe, expect, it, vi } from "vitest";
import { createConfirmationDialog } from "../src/tracker/confirmation-dialog";

function setup() {
  document.body.innerHTML = `
    <button data-trigger>Delete</button>
    <button data-success>Next</button>
    <dialog>
      <h2></h2>
      <p data-message></p>
      <p data-error></p>
      <button data-cancel>Cancel</button>
      <button data-confirm>Confirm</button>
    </dialog>
  `;
  const dialog = document.querySelector("dialog")!;
  Object.defineProperty(dialog, "showModal", {
    configurable: true,
    value: () => dialog.setAttribute("open", ""),
  });
  Object.defineProperty(dialog, "close", {
    configurable: true,
    value: (returnValue = "") => {
      dialog.returnValue = returnValue;
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    },
  });

  const elements = {
    dialog,
    title: document.querySelector("h2")!,
    message: document.querySelector<HTMLElement>("[data-message]")!,
    error: document.querySelector<HTMLElement>("[data-error]")!,
    cancel: document.querySelector<HTMLButtonElement>("[data-cancel]")!,
    confirm: document.querySelector<HTMLButtonElement>("[data-confirm]")!,
  };
  return {
    ...elements,
    trigger: document.querySelector<HTMLButtonElement>("[data-trigger]")!,
    success: document.querySelector<HTMLButtonElement>("[data-success]")!,
    controller: createConfirmationDialog(elements),
  };
}

describe("custom confirmation dialog", () => {
  it("cancels with Escape and restores the invoking focus", async () => {
    const { controller, dialog, cancel, trigger } = setup();
    trigger.focus();
    controller.open({
      title: "Delete item?",
      message: "This cannot be undone.",
      confirmLabel: "Delete item",
      action: vi.fn(),
    });
    await Promise.resolve();

    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(cancel);

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("prevents duplicate submissions and focuses the success target", async () => {
    const { controller, dialog, confirm, cancel, trigger, success } = setup();
    let resolveAction!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => {
      resolveAction = resolve;
    }));
    trigger.focus();
    controller.open({
      title: "Delete item?",
      message: "This cannot be undone.",
      confirmLabel: "Delete item",
      trigger,
      successFocus: success,
      action,
    });
    await Promise.resolve();

    confirm.click();
    confirm.click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(dialog.getAttribute("aria-busy")).toBe("true");

    resolveAction();
    await Promise.resolve();
    await Promise.resolve();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(success);
  });

  it("keeps the dialog open and displays an inline action error", async () => {
    const { controller, dialog, confirm, error } = setup();
    controller.open({
      title: "Delete item?",
      message: "This cannot be undone.",
      confirmLabel: "Delete item",
      action: async () => {
        throw new Error("Deletion failed.");
      },
    });
    await Promise.resolve();

    confirm.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(dialog.open).toBe(true);
    expect(error.textContent).toBe("Deletion failed.");
    expect(confirm.disabled).toBe(false);
    expect(document.activeElement).toBe(confirm);
  });
});
