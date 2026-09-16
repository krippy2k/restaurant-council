const STALE_RUN_LOCK_MS = 10 * 60 * 1000;

export function isStaleCouncilLock(input: {
  running?: boolean;
  runningStartedAt?: number;
  snapshotStatus?: string;
  now?: number;
  staleMs?: number;
}): boolean {
  if (!input.running) return false;
  if (input.snapshotStatus === "COMPLETE" || input.snapshotStatus === "FAILED") return true;
  if (input.runningStartedAt == null) return true;
  return (input.now ?? Date.now()) - input.runningStartedAt > (input.staleMs ?? STALE_RUN_LOCK_MS);
}
