import type { Env } from "../env.ts";

export async function notifyCouncil(env: Env, eventId: string, payload: Record<string, unknown>): Promise<void> {
  const stub = env.COUNCIL.get(env.COUNCIL.idFromName(eventId));
  await stub.fetch("https://council/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function requestReevaluate(
  env: Env,
  eventId: string,
  options?: { refreshConstraints?: boolean }
): Promise<void> {
  const stub = env.COUNCIL.get(env.COUNCIL.idFromName(eventId));
  await stub.fetch("https://council/reevaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId, refreshConstraints: Boolean(options?.refreshConstraints) })
  });
}

export function collabMetric(name: string): void {
  console.info(JSON.stringify({ metric: name }));
}
