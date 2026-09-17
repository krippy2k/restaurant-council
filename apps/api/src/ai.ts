import { createAgentRuntime, type AgentRuntime, type AgentTokenUsage } from "@rc/agents";
import type { Env } from "./env.ts";

export function runtimeFromEnv(
  env: Env,
  options?: { onUsage?: (usage: AgentTokenUsage) => void }
): AgentRuntime | undefined {
  return createAgentRuntime({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: env.OPENAI_MODEL,
    onUsage: options?.onUsage
  });
}
