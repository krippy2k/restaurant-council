export function EvaluationBars({
  evaluations,
  names
}: {
  evaluations: Array<{
    participantId: string;
    score: number;
    label: string;
    rejected: boolean;
  }>;
  names: Map<string, string>;
}) {
  if (!evaluations.length) return null;
  const unique = [];
  const seen = new Set<string>();
  for (const evaluation of evaluations) {
    if (seen.has(evaluation.participantId)) continue;
    seen.add(evaluation.participantId);
    unique.push(evaluation);
  }
  return (
    <div className="bars">
      {unique.map((evaluation) => (
        <div className="bar-row" key={evaluation.participantId}>
          <span>{names.get(evaluation.participantId) ?? "Member"}</span>
          <div className="track">
            <div
              className={`fill ${evaluation.rejected ? "conflict" : ""}`}
              style={{ width: `${evaluation.score}%` }}
            />
          </div>
          <span>{evaluation.label}</span>
        </div>
      ))}
    </div>
  );
}
