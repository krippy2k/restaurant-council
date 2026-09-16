import type { AgentRuntime } from "@rc/agents";
import type {
  CouncilProgress,
  CouncilSnapshot,
  CouncilClientEvent
} from "@rc/protocol";
import { nowIso } from "@rc/shared";
import type { DietaryAnalyzer, RestaurantSearchTool } from "@rc/tools";
import type { CouncilDependencies } from "./types.ts";

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
  dietary: { id: "dietary.analyze", name: "Dietary analyzer" }
} as const;

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
    sessionStartedAt: string
  ) {
    this.stepStartedAt = sessionStartedAt;
    this.current = {
      phase: snapshot.status,
      step: "Starting the Council",
      stepIndex: 0,
      stepCount: WORKFLOW_STEPS.length,
      startedAt: sessionStartedAt,
      sessionStartedAt
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

  async withTool<T>(
    tool: NonNullable<CouncilProgress["tool"]>,
    fn: () => Promise<T>,
    detail?: string
  ): Promise<T> {
    this.toolStack.push({ tool, detail, startedAt: nowIso() });
    await this.flush();
    try {
      return await fn();
    } finally {
      this.toolStack.pop();
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    const top = this.toolStack.at(-1);
    this.current = {
      ...this.current,
      tool: top?.tool,
      detail: top?.detail ?? this.stepDetail,
      startedAt: top?.startedAt ?? this.stepStartedAt
    };
    this.snapshot.progress = this.current;
    await this.publish(this.current);
  }
}

export function createProgressReporter(
  snapshot: CouncilSnapshot,
  deps: Pick<CouncilDependencies, "emit" | "reportProgress">,
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
    sessionStartedAt
  );
}

export function instrumentRuntime(
  runtime: AgentRuntime | undefined,
  reporter: ProgressReporter
): AgentRuntime | undefined {
  if (!runtime) return undefined;
  return {
    completeStructured: (input) => reporter.withTool(TOOLS.llm, () => runtime.completeStructured(input))
  };
}

export function instrumentRestaurants(
  restaurants: RestaurantSearchTool,
  reporter: ProgressReporter
): RestaurantSearchTool {
  return {
    search: (query, principal) =>
      reporter.withTool(TOOLS.search, () => restaurants.search(query, principal)),
    getRestaurant: (id, principal) =>
      reporter.withTool(TOOLS.details, () => restaurants.getRestaurant(id, principal)),
    discover: restaurants.discover
      ? (request, principal) =>
          reporter.withTool(TOOLS.search, () => restaurants.discover!(request, principal))
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
      reporter.withTool(TOOLS.dietary, () => analyzer.analyze(restaurant, request), restaurant.name)
  };
}
