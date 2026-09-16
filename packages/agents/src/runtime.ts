import type { ZodType, ZodTypeDef } from "zod";

export interface AgentRuntime {
  completeStructured<T>(input: {
    system: string;
    user: string;
    schema: ZodType<T, ZodTypeDef, unknown>;
  }): Promise<T>;
}

export interface LlmRuntimeConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
}

/**
 * OpenAI-compatible chat runtime. Output is always parsed with the provided
 * Zod schema; invalid JSON or extra fields never reach agent logic.
 */
export class LlmAgentRuntime implements AgentRuntime {
  constructor(private readonly config: LlmRuntimeConfig) {}

  async completeStructured<T>(input: {
    system: string;
    user: string;
    schema: ZodType<T, ZodTypeDef, unknown>;
  }): Promise<T> {
    const base = (this.config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const response = await (this.config.fetch ?? fetch)(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model ?? "gpt-4o-mini",
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
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 240)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM returned empty content");
    }
    return input.schema.parse(JSON.parse(content));
  }
}

export function createAgentRuntime(config: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): AgentRuntime | undefined {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return undefined;
  return new LlmAgentRuntime({
    apiKey,
    baseUrl: config.baseUrl,
    model: config.model
  });
}
