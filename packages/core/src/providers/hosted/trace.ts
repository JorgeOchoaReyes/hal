import type { RunTraceEvent } from "../../types.js";

export type ProviderTraceEvent = Omit<RunTraceEvent, "side">;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function eventTime(value: unknown, base?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return base === undefined ? undefined : base + value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function providerEvent(kind: ProviderTraceEvent["kind"], label: string,
  data: unknown, at?: number, nodeId?: string): ProviderTraceEvent {
  return { kind, label, data: asRecord(data), ...(at === undefined ? {} : { at }), ...(nodeId ? { nodeId } : {}) };
}

export function samePhoneNumber(left: unknown, right: unknown): boolean {
  const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
  return Boolean(digits(left)) && digits(left) === digits(right);
}
