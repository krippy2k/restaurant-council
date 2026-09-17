import type { ZodType, ZodTypeDef } from "zod";
import type { AgentTokenUsage } from "./llm-pricing.ts";

export interface AgentRuntime {
  readonly model?: string;
  completeStructured<T>(input: {
    system: string;
    user: string;
    schema: ZodType<T, ZodTypeDef, unknown>;
  }): Promise<T>;
}

export const LLM_REQUEST_TIMEOUT_MS = 20_000;

export interface LlmRuntimeConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onUsage?: (usage: AgentTokenUsage) => void;
}

/**
 * OpenAI-compatible chat runtime. Output is always parsed with the provided
 * Zod schema; invalid JSON or extra fields never reach agent logic.
 */
export class LlmAgentRuntime implements AgentRuntime {
  constructor(private readonly config: LlmRuntimeConfig) {}

  get model(): string {
    return this.config.model?.trim() || "gpt-4o-mini";
  }

  async completeStructured<T>(input: {
    system: string;
    user: string;
    schema: ZodType<T, ZodTypeDef, unknown>;
  }): Promise<T> {
    const base = (this.config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const timeoutMs = this.config.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const fetchPromise = (this.config.fetch ?? fetch)(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${input.system}\n\nReturn only JSON that matches the requested object.`
          },
          { role: "user", content: input.user }
        ]
      })
    });
    void fetchPromise.catch(() => undefined);
    let response: Response;
    try {
      response = await Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(`LLM request timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 240)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM returned empty content");
    }
    const usage = payload.usage;
    if (this.config.onUsage && usage) {
      this.config.onUsage({
        model: this.model,
        inputTokens: Number(usage.prompt_tokens) || 0,
        outputTokens: Number(usage.completion_tokens) || 0,
        cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens) || 0
      });
    }
    return input.schema.parse(JSON.parse(content));
  }
}

export function createAgentRuntime(config: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  onUsage?: LlmRuntimeConfig["onUsage"];
}): AgentRuntime | undefined {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return undefined;
  return new LlmAgentRuntime({
    apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    onUsage: config.onUsage
  });
}
