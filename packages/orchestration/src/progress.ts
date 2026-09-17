import type { AgentRuntime } from "@rc/agents";
import type {
  CouncilAgentLog,
  CouncilProgress,
  CouncilSnapshot,
  CouncilClientEvent
} from "@rc/protocol";
import { parseLoggedPayload, sanitizeAgentLogEntry, sanitizeAgentLogValue } from "@rc/protocol";
import { createId, nowIso } from "@rc/shared";
import type { DietaryAnalyzer, RestaurantSearchTool } from "@rc/tools";
import type { CouncilDependencies } from "./types.ts";
import type { CouncilSpendTracker } from "./spend.ts";

export const WORKFLOW_STEPS = [
  { phase: "DERIVING_CONSTRAINTS", label: "Interpreting preferences" },
  { phase: "SEARCHING", label: "Searching restaurants" },
  { phase: "EVALUATING", label: "Scoring restaurants" },
  { phase: "NEGOTIATING", label: "Negotiating picks" }
] as const;

export const TOOLS = {
  llm: { id: "llm.complete", name: "Language model" },
  search: { id: "restaurants.search", name: "Restaurant search" },
  details: { id: "restaurants.details", name: "Restaurant details" },
  hours: { id: "restaurants.hours", name: "Restaurant hours" },
  dietary: { id: "dietary.analyze", name: "Dietary analyzer" }
} as const;

const MAX_AGENT_LOGS = 400;

export function personalAgentProgress(displayName: string, userId: string): CouncilProgress["agent"] {
  return {
    kind: "personal",
    name: `${displayName}'s Personal Agent`,
    userId
  };
}

export function negotiatorProgress(): CouncilProgress["agent"] {
  return { kind: "negotiator", name: "Negotiator" };
}

export function stepMeta(phase: CouncilSnapshot["status"]): {
  step: string;
  stepIndex: number;
  stepCount: number;
} {
  const index = WORKFLOW_STEPS.findIndex((item) => item.phase === phase);
  return {
    step: WORKFLOW_STEPS[index]?.label ?? phase.replaceAll("_", " ").toLowerCase(),
    stepIndex: index >= 0 ? index + 1 : 0,
    stepCount: WORKFLOW_STEPS.length
  };
}

function llmCallName(progress: CouncilProgress): string {
  if (progress.agent?.kind === "personal") {
    if (progress.phase === "DERIVING_CONSTRAINTS") return "Derive constraints";
    if (progress.phase === "EVALUATING") return "Score restaurants";
  }
  if (progress.agent?.kind === "negotiator" && progress.phase === "NEGOTIATING") {
    return "Negotiate picks";
  }
  return progress.step || "Language model";
}

function namedRestaurant(value: unknown): { id?: string; name?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { id?: unknown; name?: unknown };
  if (typeof row.name !== "string" && typeof row.id !== "string") return undefined;
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    name: typeof row.name === "string" ? row.name : undefined
  };
}

function summarizeToolOutput(result: unknown): unknown {
  if (Array.isArray(result)) {
    const restaurants = result.map(namedRestaurant).filter(Boolean);
    if (restaurants.length) {
      return { count: result.length, restaurants: restaurants.slice(0, 24) };
    }
    const assessments = result.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { requirement?: unknown; status?: unknown; confidence?: unknown };
      if (typeof row.requirement !== "string") return [];
      return [
        {
          requirement: row.requirement,
          status: typeof row.status === "string" ? row.status : undefined,
          confidence: typeof row.confidence === "number" ? row.confidence : undefined
        }
      ];
    });
    if (assessments.length) return { count: result.length, assessments };
    return { count: result.length };
  }
  const restaurant = namedRestaurant(result);
  if (restaurant && result && typeof result === "object") {
    const row = result as {
      hoursCacheHit?: unknown;
      openingHours?: { sourceType?: unknown; weekdayText?: unknown };
      hoursAssessment?: { status?: unknown };
    };
    return {
      ...restaurant,
      hoursCacheHit: typeof row.hoursCacheHit === "boolean" ? row.hoursCacheHit : undefined,
      hoursStatus:
        typeof row.hoursAssessment?.status === "string" ? row.hoursAssessment.status : undefined,
      hoursSource:
        typeof row.openingHours?.sourceType === "string" ? row.openingHours.sourceType : undefined,
      weekdayText: Array.isArray(row.openingHours?.weekdayText)
        ? row.openingHours.weekdayText.slice(0, 7)
        : undefined
    };
  }
  return sanitizeAgentLogValue(result);
}

type ToolMeta = string | { detail?: string; input?: unknown };

function toolMeta(meta?: ToolMeta): { detail?: string; input?: unknown } {
  if (typeof meta === "string") return { detail: meta };
  return meta ?? {};
}

export class ProgressReporter {
  private toolStack: Array<{
    tool: NonNullable<CouncilProgress["tool"]>;
    detail?: string;
    startedAt: string;
  }> = [];
  private current: CouncilProgress;
  private stepStartedAt: string;
  private stepDetail?: string;

  constructor(
    private readonly snapshot: CouncilSnapshot,
    private readonly publish: (progress: CouncilProgress) => Promise<void>,
    sessionStartedAt: string,
    private readonly spend?: CouncilSpendTracker
  ) {
    this.stepStartedAt = sessionStartedAt;
    snapshot.agentLogs = snapshot.agentLogs ?? [];
    this.current = {
      phase: snapshot.status,
      step: "Starting the Council",
      stepIndex: 0,
      stepCount: WORKFLOW_STEPS.length,
      startedAt: sessionStartedAt,
      sessionStartedAt,
      spend: this.spend?.snapshot()
    };
  }

  get value(): CouncilProgress {
    return this.current;
  }

  async begin(input: {
    phase: CouncilSnapshot["status"];
    step?: string;
    agent?: CouncilProgress["agent"];
    detail?: string;
  }): Promise<void> {
    this.toolStack = [];
    const meta = stepMeta(input.phase);
    const startedAt = nowIso();
    this.stepStartedAt = startedAt;
    this.stepDetail = input.detail;
    this.current = {
      phase: input.phase,
      step: input.step ?? meta.step,
      stepIndex: meta.stepIndex,
      stepCount: meta.stepCount,
      agent: input.agent,
      detail: input.detail,
      startedAt,
      sessionStartedAt: this.current.sessionStartedAt
    };
    await this.flush();
  }

  async complete(phase: "COMPLETE" | "FAILED", step?: string): Promise<void> {
    this.toolStack = [];
    this.stepDetail = undefined;
    const completedAt = nowIso();
    this.stepStartedAt = this.current.sessionStartedAt;
    this.current = {
      phase,
      step: step ?? (phase === "COMPLETE" ? "Council complete" : "Council failed"),
      stepIndex: WORKFLOW_STEPS.length,
      stepCount: WORKFLOW_STEPS.length,
      startedAt: this.current.sessionStartedAt,
      sessionStartedAt: this.current.sessionStartedAt,
      completedAt
    };
    await this.flush();
  }

  async withLlm<T>(
    input: { system: string; user: string },
    fn: () => Promise<T>,
    model?: string
  ): Promise<T> {
    const id = createId("alog");
    const name = llmCallName(this.current);
    this.toolStack.push({ tool: TOOLS.llm, detail: name, startedAt: nowIso() });
    this.pushLog({
      id,
      at: nowIso(),
      kind: "llm",
      status: "running",
      agent: this.current.agent,
      step: this.current.step,
      name,
      model,
      tool: TOOLS.llm,
      input: {
        system: input.system,
        user: parseLoggedPayload(input.user)
      }
    });
    await this.flush();
    try {
      const result = await fn();
      this.patchLog(id, {
        status: "ok",
        completedAt: nowIso(),
        output: result
      });
      return result;
    } catch (error) {
      this.patchLog(id, {
        status: "error",
        completedAt: nowIso(),
        error: error instanceof Error ? error.message : "Language model call failed"
      });
      throw error;
    } finally {
      this.toolStack.pop();
      await this.flush();
    }
  }

  async withTool<T>(
    tool: NonNullable<CouncilProgress["tool"]>,
    fn: () => Promise<T>,
    meta?: ToolMeta
  ): Promise<T> {
    const extra = toolMeta(meta);
    const id = createId("alog");
    this.toolStack.push({ tool, detail: extra.detail, startedAt: nowIso() });
    this.pushLog({
      id,
      at: nowIso(),
      kind: "tool",
      status: "running",
      agent: this.current.agent,
      step: this.current.step,
      name: extra.detail ? `${tool.name} · ${extra.detail}` : tool.name,
      tool,
      input: extra.input ?? (extra.detail ? { detail: extra.detail } : undefined)
    });
    await this.flush();
    try {
      const result = await fn();
      this.patchLog(id, {
        status: "ok",
        completedAt: nowIso(),
        output: summarizeToolOutput(result)
      });
      return result;
    } catch (error) {
      this.patchLog(id, {
        status: "error",
        completedAt: nowIso(),
        error: error instanceof Error ? error.message : "Tool call failed"
      });
      throw error;
    } finally {
      this.toolStack.pop();
      await this.flush();
    }
  }

  private pushLog(entry: CouncilAgentLog): void {
    const logs = this.snapshot.agentLogs ?? [];
    logs.push(sanitizeAgentLogEntry(entry));
    if (logs.length > MAX_AGENT_LOGS) logs.splice(0, logs.length - MAX_AGENT_LOGS);
    this.snapshot.agentLogs = logs;
  }

  private patchLog(id: string, patch: Partial<CouncilAgentLog>): void {
    const logs = this.snapshot.agentLogs;
    if (!logs) return;
    const index = logs.findIndex((item) => item.id === id);
    if (index < 0) return;
    logs[index] = sanitizeAgentLogEntry({ ...logs[index], ...patch });
  }

  private async flush(): Promise<void> {
    const top = this.toolStack.at(-1);
    this.current = {
      ...this.current,
      tool: top?.tool,
      detail: top?.detail ?? this.stepDetail,
      startedAt: top?.startedAt ?? this.stepStartedAt,
      spend: this.spend?.snapshot()
    };
    this.snapshot.progress = this.current;
    await this.publish(this.current);
  }
}

export function createProgressReporter(
  snapshot: CouncilSnapshot,
  deps: Pick<CouncilDependencies, "emit" | "reportProgress" | "spend">,
  sessionStartedAt = nowIso()
): ProgressReporter {
  return new ProgressReporter(
    snapshot,
    async (progress) => {
      snapshot.progress = progress;
      if (deps.reportProgress) {
        await deps.reportProgress(progress, snapshot);
        return;
      }
      const event: CouncilClientEvent = {
        type: "council.progress",
        at: progress.startedAt,
        message: progress.detail ? `${progress.step} · ${progress.detail}` : progress.step
      };
      await deps.emit(event, snapshot);
    },
    sessionStartedAt,
    deps.spend
  );
}

export function instrumentRuntime(
  runtime: AgentRuntime | undefined,
  reporter: ProgressReporter
): AgentRuntime | undefined {
  if (!runtime) return undefined;
  return {
    model: runtime.model,
    completeStructured: (input) =>
      reporter.withLlm(input, () => runtime.completeStructured(input), runtime.model)
  };
}

export function instrumentRestaurants(
  restaurants: RestaurantSearchTool,
  reporter: ProgressReporter
): RestaurantSearchTool {
  return {
    search: (query, principal) =>
      reporter.withTool(TOOLS.search, () => restaurants.search(query, principal), {
        input: {
          eventId: query.eventId,
          latitude: query.latitude,
          longitude: query.longitude,
          radiusKm: query.radiusKm,
          cuisines: query.cuisines,
          maxPriceLevel: query.maxPriceLevel,
          query: query.query
        }
      }),
    getRestaurant: (id, principal) =>
      reporter.withTool(TOOLS.details, () => restaurants.getRestaurant(id, principal), {
        input: { restaurantId: id }
      }),
    enrichHours: restaurants.enrichHours
      ? (id, principal) =>
          reporter.withTool(TOOLS.hours, () => restaurants.enrichHours!(id, principal), {
            input: { restaurantId: id }
          })
      : undefined,
    discover: restaurants.discover
      ? (request, principal) =>
          reporter.withTool(TOOLS.search, () => restaurants.discover!(request, principal), {
            input: {
              latitude: request.location.latitude,
              longitude: request.location.longitude,
              radiusMeters: request.radiusMeters,
              cuisines: request.cuisines,
              priceLevels: request.priceLevels,
              textQuery: request.textQuery,
              limit: request.limit
            }
          })
      : undefined
  };
}

export function instrumentDietary(
  analyzer: DietaryAnalyzer | undefined,
  reporter: ProgressReporter
): DietaryAnalyzer | undefined {
  if (!analyzer) return undefined;
  return {
    analyze: (restaurant, request) =>
      reporter.withTool(TOOLS.dietary, () => analyzer.analyze(restaurant, request), {
        detail: restaurant.name,
        input: {
          restaurantId: restaurant.id,
          restaurant: restaurant.name,
          requirements: request.requirements,
          depth: request.depth
        }
      })
  };
}
