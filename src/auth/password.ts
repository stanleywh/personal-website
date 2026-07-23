export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./";

export type PasswordRequirement =
  | "minimumLength"
  | "lowercase"
  | "uppercase"
  | "digit"
  | "symbol";

export interface PasswordIssue {
  requirement: PasswordRequirement;
  message: string;
}

export function passwordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push({
      requirement: "minimumLength",
      message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    });
  }
  if (!/[a-z]/.test(password)) {
    issues.push({ requirement: "lowercase", message: "Add a lowercase letter." });
  }
  if (!/[A-Z]/.test(password)) {
    issues.push({ requirement: "uppercase", message: "Add an uppercase letter." });
  }
  if (!/[0-9]/.test(password)) {
    issues.push({ requirement: "digit", message: "Add a number." });
  }
  if (![...password].some((character) => PASSWORD_SYMBOLS.includes(character))) {
    issues.push({ requirement: "symbol", message: "Add a symbol." });
  }
  return issues;
}

export function validatePassword(password: string): void {
  const [issue] = passwordIssues(password);
  if (issue) throw new Error(issue.message);
}

export function validatePasswordConfirmation(password: string, confirmation: string): void {
  validatePassword(password);
  if (password !== confirmation) throw new Error("Passwords do not match.");
}
