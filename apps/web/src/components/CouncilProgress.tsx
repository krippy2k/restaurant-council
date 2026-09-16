import { useEffect, useState } from "react";
import type { CouncilSnapshot } from "../api";

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
  starting = false
}: {
  snapshot: CouncilSnapshot | null;
  starting?: boolean;
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
      </dl>
    </section>
  );
}
