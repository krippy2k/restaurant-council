import { z } from "zod";

const REDACTED_KEYS = new Set([
  "privatenotes",
  "sourcetext",
  "source_text",
  "privatepreference",
  "privateconstraints"
]);

const MAX_STRING = 4_000;
const MAX_ARRAY = 40;

export const CouncilAgentLogAgentSchema = z.object({
  kind: z.enum(["personal", "negotiator", "council"]),
  name: z.string(),
  userId: z.string().optional()
});

export const CouncilAgentLogSchema = z.object({
  id: z.string(),
  at: z.string(),
  completedAt: z.string().optional(),
  kind: z.enum(["llm", "tool"]),
  status: z.enum(["running", "ok", "error"]),
  agent: CouncilAgentLogAgentSchema.optional(),
  step: z.string().optional(),
  name: z.string(),
  model: z.string().optional(),
  tool: z
    .object({
      id: z.string(),
      name: z.string()
    })
    .optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional()
});

export type CouncilAgentLog = z.infer<typeof CouncilAgentLogSchema>;

function redacted(value: unknown): { redacted: true; count: number } {
  if (Array.isArray(value)) return { redacted: true, count: value.length };
  return { redacted: true, count: value == null || value === "" ? 0 : 1 };
}

export function sanitizeAgentLogValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => {
        if (!item || typeof item !== "object") return true;
        return (item as { visibility?: string }).visibility !== "PRIVATE_DERIVED";
      })
      .slice(0, MAX_ARRAY)
      .map((item) => sanitizeAgentLogValue(item, depth + 1));
    if (value.length > MAX_ARRAY) {
      return { truncated: true, total: value.length, items };
    }
    return items;
  }
  if (typeof value !== "object") return String(value);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = redacted(nested);
      continue;
    }
    out[key] = sanitizeAgentLogValue(nested, depth + 1);
  }
  return out;
}

export function parseLoggedPayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function sanitizeAgentLogEntry(entry: CouncilAgentLog): CouncilAgentLog {
  return {
    ...entry,
    input: entry.input === undefined ? undefined : sanitizeAgentLogValue(entry.input),
    output: entry.output === undefined ? undefined : sanitizeAgentLogValue(entry.output),
    error: entry.error
      ? entry.error.length > MAX_STRING
        ? `${entry.error.slice(0, MAX_STRING)}…`
        : entry.error
      : undefined
  };
}
