/** Small argument readers so every handler rejects bad input the same way. */

function asRecord(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null) return {};
  return args as Record<string, unknown>;
}

export function requireTabId(args: unknown): number {
  const value = asRecord(args).tabId;

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`tabId must be a non-negative integer (got ${JSON.stringify(value)}). Call tabs_context first.`);
  }
  return value;
}

export function requireString(args: unknown, key: string): string {
  const value = asRecord(args)[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(args: unknown, key: string): string | undefined {
  const value = asRecord(args)[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
