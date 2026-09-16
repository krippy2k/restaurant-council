import { createAgentRuntime, type AgentRuntime } from "@rc/agents";
import type { Env } from "./env.ts";

export function runtimeFromEnv(env: Env): AgentRuntime | undefined {
  return createAgentRuntime({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: env.OPENAI_MODEL
  });
}
