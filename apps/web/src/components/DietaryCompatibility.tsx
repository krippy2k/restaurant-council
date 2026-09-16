import type { RestaurantView } from "../restaurant-display";

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  likely: "Likely",
  uncertain: "Uncertain",
  unsupported: "Not supported",
  conflicting: "Conflicting information"
};

const STATUS_MARK: Record<string, string> = {
  confirmed: "✓",
  likely: "~",
  uncertain: "?",
  unsupported: "✕",
  conflicting: "!"
};

function requirementLabel(requirement: string): string {
  return requirement
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

export function DietaryCompatibility({
  restaurant,
  compact = false
}: {
  restaurant: RestaurantView;
  compact?: boolean;
}) {
  const assessments = restaurant.dietaryAssessments ?? [];
  if (assessments.length === 0) return null;
  return (
    <div className={`dietary-compat ${compact ? "compact" : ""}`}>
      {compact ? null : <h3>Dietary compatibility</h3>}
      <ul>
        {assessments.map((assessment) => {
          const source = assessment.evidence.find((item) => item.sourceUrl);
          return (
            <li key={`${assessment.restaurantId}-${assessment.requirement}`}>
              <span className={`dietary-status ${assessment.status}`}>
                {STATUS_MARK[assessment.status] ?? "?"} {requirementLabel(assessment.requirement)}:{" "}
                {STATUS_LABEL[assessment.status] ?? assessment.status}
              </span>
              {compact ? null : (
                <span className="muted">
                  {assessment.evidence.some((item) => item.sourceType === "human-verification")
                    ? " A participant checked with the restaurant. This is not a medical-safety guarantee."
                    : assessment.status === "uncertain"
                      ? ` We could not fully verify ${requirementLabel(assessment.requirement).toLowerCase()} from published information.`
                      : source?.excerpt
                        ? ` ${source.excerpt}`
                        : ""}
                  {source?.sourceUrl ? (
                    <>
                      {" "}
                      <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                        {source.sourceType === "official-allergen-info"
                          ? "View allergen information"
                          : source.sourceType.includes("menu")
                            ? "View menu"
                            : "View source"}
                      </a>
                    </>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {compact ? null : (
        <p className="muted dietary-disclaimer">
          Based on published restaurant information. This is not a medical-safety guarantee.
        </p>
      )}
    </div>
  );
}
