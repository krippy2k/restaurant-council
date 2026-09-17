export interface AgentTokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/** Standard API list rates, USD per 1M tokens. */
const MODEL_RATES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 }
};

const DEFAULT_RATES = MODEL_RATES["gpt-4o-mini"]!;

export function modelRates(model: string): { input: number; cachedInput: number; output: number } {
  const key = model.trim().toLowerCase();
  return MODEL_RATES[key] ?? DEFAULT_RATES;
}

export function estimateAgentUsd(usage: AgentTokenUsage): number {
  const rates = modelRates(usage.model);
  const cached = Math.min(Math.max(0, usage.cachedInputTokens), Math.max(0, usage.inputTokens));
  const uncached = Math.max(0, usage.inputTokens - cached);
  const usd =
    (uncached * rates.input + cached * rates.cachedInput + Math.max(0, usage.outputTokens) * rates.output) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
