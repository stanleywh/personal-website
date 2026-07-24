export interface StarRatingController {
  value(): number | undefined;
  validate(message?: string): boolean;
  reset(value?: number): void;
}

interface StarRatingOptions {
  name: string;
  value?: number;
  required?: boolean;
  errorElement?: HTMLElement;
  label?: string;
}

const SCORES = [1, 2, 3, 4, 5] as const;

function isScore(value: number | undefined): value is (typeof SCORES)[number] {
  return value !== undefined && SCORES.includes(value as (typeof SCORES)[number]);
}

export function mountStarRating(
  container: HTMLElement,
  options: StarRatingOptions,
): StarRatingController {
  container.replaceChildren();
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", options.label ?? "Mastery rating");
  container.setAttribute("aria-required", String(Boolean(options.required)));
  if (options.errorElement?.id) {
    container.setAttribute("aria-describedby", options.errorElement.id);
  }

  const radios = SCORES.map((score) => {
    const label = document.createElement("label");
    label.className = "rating-option";
    label.dataset.score = String(score);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = options.name;
    input.value = String(score);
    input.required = Boolean(options.required) && score === 1;
    input.setAttribute("aria-label", `${score} star${score === 1 ? "" : "s"}`);

    const star = document.createElement("span");
    star.setAttribute("aria-hidden", "true");
    star.textContent = "★";

    label.append(input, star);
    container.append(label);
    return input;
  });

  function selectedValue(): number | undefined {
    const selected = radios.find((radio) => radio.checked);
    return selected ? Number(selected.value) : undefined;
  }

  function updatePresentation(): void {
    const selected = selectedValue();
    container.dataset.value = selected ? String(selected) : "";
    container.setAttribute("aria-invalid", "false");
    options.errorElement?.replaceChildren();

    radios.forEach((radio, index) => {
      radio.tabIndex = selected
        ? (radio.checked ? 0 : -1)
        : (index === 0 ? 0 : -1);
      radio.closest(".rating-option")?.classList.toggle(
        "is-filled",
        selected !== undefined && Number(radio.value) <= selected,
      );
    });
  }

  function select(index: number, focus = true): void {
    const target = radios[Math.max(0, Math.min(radios.length - 1, index))];
    target.checked = true;
    updatePresentation();
    if (focus) target.focus();
  }

  radios.forEach((radio, index) => {
    radio.addEventListener("change", updatePresentation);
    radio.addEventListener("keydown", (event) => {
      let targetIndex: number | undefined;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        targetIndex = Math.min(radios.length - 1, index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        targetIndex = Math.max(0, index - 1);
      } else if (event.key === "Home") {
        targetIndex = 0;
      } else if (event.key === "End") {
        targetIndex = radios.length - 1;
      } else if (event.key === " " || event.key === "Enter") {
        targetIndex = index;
      }

      if (targetIndex === undefined) return;
      event.preventDefault();
      select(targetIndex);
    });
  });

  const controller: StarRatingController = {
    value: selectedValue,
    validate(message = "Choose a mastery rating from 1 to 5."): boolean {
      if (!options.required || selectedValue() !== undefined) {
        updatePresentation();
        return true;
      }
      container.setAttribute("aria-invalid", "true");
      if (options.errorElement) options.errorElement.textContent = message;
      radios[0].focus();
      return false;
    },
    reset(value?: number): void {
      radios.forEach((radio) => {
        radio.checked = isScore(value) && Number(radio.value) === value;
      });
      updatePresentation();
    },
  };

  controller.reset(options.value);
  return controller;
}
