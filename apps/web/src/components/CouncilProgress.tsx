import { useEffect, useState } from "react";
import type { CouncilSnapshot } from "../api";

type AgentLog = NonNullable<CouncilSnapshot["agentLogs"]>[number];

const STEPS = [
  { phase: "DERIVING_CONSTRAINTS", label: "Preferences" },
  { phase: "SEARCHING", label: "Search" },
  { phase: "EVALUATING", label: "Scoring" },
  { phase: "NEGOTIATING", label: "Negotiate" }
];

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function placesBreakdown(places: {
  calls: number;
  search: number;
  details: number;
  hours: number;
  photos: number;
}): string {
  const parts = [];
  if (places.search) parts.push(countLabel(places.search, "search", "searches"));
  if (places.hours) parts.push(countLabel(places.hours, "hours lookup"));
  if (places.details) parts.push(countLabel(places.details, "details lookup"));
  if (places.photos) parts.push(countLabel(places.photos, "photo"));
  if (!parts.length) return countLabel(places.calls, "call");
  return parts.join(" · ");
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function logDuration(entry: AgentLog): string | undefined {
  if (!entry.completedAt) return undefined;
  const start = Date.parse(entry.at);
  const end = Date.parse(entry.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return formatElapsed(end - start);
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === undefined) return <p className="muted">None</p>;
  if (typeof value === "string") return <pre className="agent-log-json">{value}</pre>;
  return <pre className="agent-log-json">{formatJson(value)}</pre>;
}

function toolSummary(entry: AgentLog): string {
  const output = entry.output;
  if (output && typeof output === "object" && "count" in output && typeof output.count === "number") {
    return countLabel(output.count, "result");
  }
  if (output && typeof output === "object" && "name" in output && typeof output.name === "string") {
    const status =
      "hoursStatus" in output && typeof output.hoursStatus === "string" ? output.hoursStatus : undefined;
    const cache =
      "hoursCacheHit" in output && output.hoursCacheHit === true
        ? "cache"
        : undefined;
    return [output.name, cache, status].filter(Boolean).join(" · ");
  }
  if (entry.input && typeof entry.input === "object" && "restaurant" in entry.input) {
    return String(entry.input.restaurant);
  }
  if (entry.input && typeof entry.input === "object" && "restaurantId" in entry.input) {
    return String(entry.input.restaurantId);
  }
  return entry.status;
}

type LogRow =
  | { kind: "llm" | "tool"; entry: AgentLog }
  | { kind: "tools"; name: string; toolId: string; entries: AgentLog[] };

function rowsFromLogs(logs: AgentLog[]): LogRow[] {
  const rows: LogRow[] = [];
  for (const entry of logs) {
    const last = rows.at(-1);
    if (entry.kind === "tool") {
      const toolId = entry.tool?.id ?? entry.name;
      if (last?.kind === "tools" && last.toolId === toolId) {
        last.entries.push(entry);
        continue;
      }
      if (last?.kind === "tool" && (last.entry.tool?.id ?? last.entry.name) === toolId) {
        rows[rows.length - 1] = {
          kind: "tools",
          name: last.entry.tool?.name ?? last.entry.name,
          toolId,
          entries: [last.entry, entry]
        };
        continue;
      }
      rows.push({ kind: "tool", entry });
      continue;
    }
    rows.push({ kind: "llm", entry });
  }
  return rows;
}

type AgentGroup = {
  key: string;
  agent?: AgentLog["agent"];
  entries: AgentLog[];
};

function groupLogs(logs: AgentLog[]): AgentGroup[] {
  const groups: AgentGroup[] = [];
  for (const entry of logs) {
    const key = entry.agent?.name ?? "Council";
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.entries.push(entry);
      continue;
    }
    groups.push({ key, agent: entry.agent, entries: [entry] });
  }
  return groups;
}

function AgentLogEntry({ entry }: { entry: AgentLog }) {
  const duration = logDuration(entry);
  return (
    <details className={`agent-log-entry ${entry.kind} ${entry.status}`}>
      <summary>
        <span className="agent-log-kind">{entry.kind === "llm" ? "Model" : "Tool"}</span>
        {entry.kind === "llm" && entry.model ? <span className="agent-log-model">{entry.model}</span> : null}
        <span className="agent-log-name">{entry.name}</span>
        {entry.kind === "tool" ? <span className="muted">{toolSummary(entry)}</span> : null}
        <span className={`agent-log-status ${entry.status}`}>{entry.status}</span>
        {duration ? <span className="muted">{duration}</span> : null}
      </summary>
      {entry.error ? <p className="agent-log-error">{entry.error}</p> : null}
      {entry.kind === "llm" ? (
        <>
          {entry.model ? (
            <p className="agent-log-model-line">
              Model <strong>{entry.model}</strong>
            </p>
          ) : null}
          <h4>System</h4>
          <JsonBlock value={entry.input && typeof entry.input === "object" && "system" in entry.input ? entry.input.system : undefined} />
          <h4>Input</h4>
          <JsonBlock value={entry.input && typeof entry.input === "object" && "user" in entry.input ? entry.input.user : entry.input} />
          <h4>Output</h4>
          <JsonBlock value={entry.output} />
        </>
      ) : (
        <>
          <h4>Input</h4>
          <JsonBlock value={entry.input} />
          <h4>Output</h4>
          <JsonBlock value={entry.output} />
        </>
      )}
    </details>
  );
}

function AgentLogs({ logs }: { logs: AgentLog[] }) {
  if (!logs.length) {
    return <p className="muted">No agent calls yet. Start the Council to see model inputs, outputs, and tool calls.</p>;
  }
  return (
    <div className="agent-log-groups">
      {groupLogs(logs).map((group) => (
        <section key={`${group.key}-${group.entries[0]?.id}`} className="agent-log-group">
          <header>
            <strong>{group.key}</strong>
            {group.entries[0]?.step ? <span className="muted">{group.entries[0].step}</span> : null}
          </header>
          {rowsFromLogs(group.entries).map((row) => {
            if (row.kind === "tools") {
              const failed = row.entries.filter((item) => item.status === "error").length;
              const running = row.entries.some((item) => item.status === "running");
              return (
                <details key={row.entries[0]?.id} className="agent-log-bundle">
                  <summary>
                    <span className="agent-log-kind">Tool</span>
                    <span className="agent-log-name">{row.name}</span>
                    <span className="muted">
                      {countLabel(row.entries.length, "call")}
                      {failed ? ` · ${failed} failed` : ""}
                      {running ? " · running" : ""}
                    </span>
                  </summary>
                  <ul>
                    {row.entries.map((entry) => (
                      <li key={entry.id}>
                        <AgentLogEntry entry={entry} />
                      </li>
                    ))}
                  </ul>
                </details>
              );
            }
            return <AgentLogEntry key={row.entry.id} entry={row.entry} />;
          })}
        </section>
      ))}
    </div>
  );
}

function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function CouncilProgress({
  snapshot,
  starting = false,
  onClearCache,
  clearingCache = false
}: {
  snapshot: CouncilSnapshot | null;
  starting?: boolean;
  onClearCache?: () => void;
  clearingCache?: boolean;
}) {
  const progress = snapshot?.progress;
  const phase = progress?.phase ?? snapshot?.status ?? "CREATED";
  const running =
    Boolean(progress) &&
    phase !== "COMPLETE" &&
    phase !== "FAILED" &&
    phase !== "CREATED" &&
    !progress?.completedAt;
  const now = useClock(running);
  const activityStart = progress?.startedAt ? Date.parse(progress.startedAt) : NaN;
  const sessionStart = progress?.sessionStartedAt ? Date.parse(progress.sessionStartedAt) : NaN;
  const end = progress?.completedAt ? Date.parse(progress.completedAt) : now;
  const activityMs = Number.isFinite(activityStart) ? end - activityStart : 0;
  const sessionMs = Number.isFinite(sessionStart) ? end - sessionStart : 0;
  const currentIndex = STEPS.findIndex((item) => item.phase === phase);
  const [logTab, setLogTab] = useState<"activity" | "agents">("activity");
  const agentLogs = snapshot?.agentLogs ?? [];

  return (
    <section className={`council-progress${running ? " running" : ""}${phase === "FAILED" ? " failed" : ""}`}>
      <div className="council-progress-head">
        <p className="kicker">{running ? "Live workflow" : phase === "FAILED" ? "Stopped" : "Council workflow"}</p>
        <p className="council-progress-status" aria-live="polite">
          {running
            ? progress?.step
            : starting && (phase === "CREATED" || !snapshot)
              ? "Starting the Council"
              : progress?.step ??
                (phase === "CREATED" || !snapshot
                  ? "Waiting for the host to start the Council"
                  : snapshot.status.replaceAll("_", " ").toLowerCase())}
        </p>
      </div>
      <ol className="progress-steps">
        {STEPS.map((item, index) => {
          const state =
            phase === "COMPLETE" || (currentIndex >= 0 && index < currentIndex)
              ? "done"
              : item.phase === phase
                ? "active"
                : "pending";
          return (
            <li key={item.phase} className={`progress-step ${state}`}>
              <span className="progress-dot" />
              <span>{item.label}</span>
            </li>
          );
        })}
      </ol>
      <dl className="progress-meta">
        {progress?.stepIndex && progress.stepCount ? (
          <>
            <dt>Step</dt>
            <dd>
              {Math.min(progress.stepIndex, progress.stepCount)} of {progress.stepCount}
            </dd>
          </>
        ) : null}
        <dt>Agent</dt>
        <dd>{progress?.agent?.name ?? (running ? "Council" : "—")}</dd>
        <dt>Tool</dt>
        <dd>
          {progress?.tool
            ? `${progress.tool.name}${progress.detail ? ` · ${progress.detail}` : ""}`
            : running
              ? "Working…"
              : "None"}
        </dd>
        <dt>{progress?.tool ? "Tool time" : "Step time"}</dt>
        <dd>{progress ? formatElapsed(activityMs) : "—"}</dd>
        <dt>Session</dt>
        <dd>{progress ? formatElapsed(sessionMs) : "—"}</dd>
        {progress?.spend ? (
          <>
            <dt title="Estimated at published list rates, before Google monthly free usage">Est. spend</dt>
            <dd title="Estimated at published list rates, before Google monthly free usage">
              {formatUsd(progress.spend.estimatedUsd)}
            </dd>
            <dt>Agents</dt>
            <dd>
              {formatUsd(progress.spend.agents.estimatedUsd)}
              {progress.spend.agents.calls
                ? ` · ${progress.spend.agents.calls} call${progress.spend.agents.calls === 1 ? "" : "s"} · ${formatTokens(progress.spend.agents.inputTokens + progress.spend.agents.outputTokens)} tokens`
                : " · none yet"}
              {(progress.spend.agents.byModel ?? []).length ? (
                <ul className="progress-model-spend">
                  {(progress.spend.agents.byModel ?? []).map((item) => (
                    <li key={item.model}>
                      <span className="agent-log-model">{item.model}</span>
                      {` ${formatUsd(item.estimatedUsd)} · ${countLabel(item.calls, "call")} · ${formatTokens(item.inputTokens + item.outputTokens)} tokens`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </dd>
            <dt>Places</dt>
            <dd>
              {formatUsd(progress.spend.places.estimatedUsd)}
              {progress.spend.places.calls ? ` · ${placesBreakdown(progress.spend.places)}` : " · none yet"}
            </dd>
            <dt>Cached</dt>
            <dd>
              {(progress.spend.places.cachedCalls ?? 0) > 0
                ? placesBreakdown({
                    calls: progress.spend.places.cachedCalls ?? 0,
                    search: progress.spend.places.cachedSearch ?? 0,
                    hours: progress.spend.places.cachedHours ?? 0,
                    details: progress.spend.places.cachedDetails ?? 0,
                    photos: progress.spend.places.cachedPhotos ?? 0
                  })
                : "none"}
            </dd>
          </>
        ) : null}
        {onClearCache ? (
          <>
            <dt className="progress-cache-label">Actions</dt>
            <dd className="progress-cache-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={clearingCache || running || starting}
                onClick={onClearCache}
              >
                {clearingCache ? "Clearing…" : "Clear cache"}
              </button>
            </dd>
          </>
        ) : null}
      </dl>
      <details className="council-activity">
        <summary>
          Activity
          <span className="muted">
            {snapshot?.events.length ? ` ${snapshot.events.length}` : ""}
            {agentLogs.length ? ` · ${agentLogs.length} agent` : ""}
          </span>
        </summary>
        <div className="council-log-tabs" role="tablist" aria-label="Council logs">
          <button
            type="button"
            role="tab"
            aria-selected={logTab === "activity"}
            className={logTab === "activity" ? "active" : undefined}
            onClick={() => setLogTab("activity")}
          >
            Activity
            {snapshot?.events.length ? <span className="muted"> {snapshot.events.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={logTab === "agents"}
            className={logTab === "agents" ? "active" : undefined}
            onClick={() => setLogTab("agents")}
          >
            Agent logs
            {agentLogs.length ? <span className="muted"> {agentLogs.length}</span> : null}
          </button>
        </div>
        {logTab === "activity" ? (
          <div className="log" role="tabpanel">
            {snapshot?.events.length ? (
              snapshot.events.map((item, index) => (
                <div key={`${item.at}-${index}`}>{item.message}</div>
              ))
            ) : (
              <p className="muted">No activity yet.</p>
            )}
          </div>
        ) : (
          <div className="agent-logs" role="tabpanel">
            <AgentLogs logs={agentLogs} />
          </div>
        )}
      </details>
    </section>
  );
}
