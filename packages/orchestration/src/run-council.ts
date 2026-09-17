import { deriveConstraints, evaluateCandidates, negotiate } from "@rc/agents";
import {
  createNegotiatorPrincipal,
  createPersonalAgentPrincipal
} from "@rc/auth";
import type {
  CandidateEvaluation,
  CouncilClientEvent,
  CouncilConstraint,
  CouncilSnapshot,
  RestaurantCandidate
} from "@rc/protocol";
import { AppError, ErrorCodes, createId, nowIso } from "@rc/shared";
import {
  buildSearchRequest,
  searchAreaFromEvent
} from "@rc/tools";
import { attachDietaryAssessments, promisingForDeepDietary } from "./dietary.ts";
import { retainCandidatesByHours } from "./hours.ts";
import { mediaByRestaurantId, mergeRestaurantMedia } from "./candidate-media.ts";
import type { CouncilDependencies } from "./types.ts";
import {
  createProgressReporter,
  instrumentDietary,
  instrumentRestaurants,
  instrumentRuntime,
  negotiatorProgress,
  personalAgentProgress
} from "./progress.ts";

function keepKnownMedia(
  candidates: RestaurantCandidate[],
  previous?: CouncilSnapshot
): RestaurantCandidate[] {
  if (!previous) return candidates;
  const media = mediaByRestaurantId(previous);
  return candidates.map((candidate) => mergeRestaurantMedia(candidate, media.get(candidate.id)));
}

function event(
  type: CouncilClientEvent["type"],
  message: string,
  payload?: Record<string, unknown>
): CouncilClientEvent {
  return { type, at: nowIso(), message, payload };
}

export async function runCouncil(
  eventId: string,
  deps: CouncilDependencies
): Promise<CouncilSnapshot> {
  if (!deps.runtime) {
    throw new AppError(
      ErrorCodes.AGENTS_NOT_CONFIGURED,
      "Council agents require OPENAI_API_KEY. Add it to .dev.vars at the repo root and restart the API.",
      503
    );
  }

  const councilEvent = await deps.getEvent(eventId);
  const members = await deps.listMembers(eventId);
  const joined = members.filter((member) => member.status !== "invited");
  const negotiator = createNegotiatorPrincipal(eventId);

  const participants = [];
  for (const member of joined) {
    const user = await deps.getUser(member.userId);
    const agent = createPersonalAgentPrincipal({
      userId: member.userId,
      eventId
    });
    participants.push({
      userId: member.userId,
      displayName: user.displayName ?? user.email ?? "Member",
      agentId: agent.agentId
    });
  }

  const snapshot: CouncilSnapshot = {
    sessionId: createId("csn"),
    eventId,
    status: "CREATED",
    participants,
    negotiatorId: negotiator.agentId,
    constraints: [],
    candidates: [],
    evaluations: [],
    recommendations: [],
    events: []
  };

  const reporter = createProgressReporter(snapshot, deps);
  const runtime = instrumentRuntime(deps.runtime, reporter);
  if (!runtime) {
    throw new AppError(
      ErrorCodes.AGENTS_NOT_CONFIGURED,
      "Council agents require OPENAI_API_KEY. Add it to .dev.vars at the repo root and restart the API.",
      503
    );
  }
  const restaurants = instrumentRestaurants(deps.restaurants, reporter);
  const dietary = instrumentDietary(deps.dietary, reporter);

  const push = async (clientEvent: CouncilClientEvent) => {
    snapshot.events.push(clientEvent);
    await deps.emit(clientEvent, snapshot);
    await deps.persist(snapshot);
  };

  try {
    snapshot.status = "DERIVING_CONSTRAINTS";
    await reporter.begin({
      phase: "DERIVING_CONSTRAINTS",
      agent: negotiatorProgress()
    });
    await push(
      event(
        "council.started",
        "Council is in session. Personal agents and the Negotiator are model-backed."
      )
    );
    await deps.audit({
      principal: negotiator,
      action: "COUNCIL_STARTED",
      eventId,
      decision: "ALLOW"
    });

    const publicPreferences = await deps.listPublicPreferences(eventId);
    const constraints: CouncilConstraint[] = [];

    for (const participant of participants) {
      const principal = createPersonalAgentPrincipal({
        userId: participant.userId,
        eventId
      });
      await reporter.begin({
        phase: "DERIVING_CONSTRAINTS",
        step: `Reading ${participant.displayName}'s preferences`,
        agent: personalAgentProgress(participant.displayName, participant.userId)
      });
      const vault = await deps.readVaultForAgent(
        principal,
        participant.userId,
        eventId
      );
      const derived = await deriveConstraints({
        principal,
        eventId,
        publicPreferences,
        privateRecords: vault,
        runtime
      });
      constraints.push(...derived);
      await deps.audit({
        principal,
        action: "PRIVATE_CONSTRAINT_DERIVED",
        eventId,
        resource: `constraints:${derived.filter((item) => item.visibility === "PRIVATE_DERIVED").length}`,
        decision: "ALLOW"
      });
    }

    snapshot.constraints = constraints;
    await deps.saveConstraints(constraints);
    await push(
      event(
        "constraints.collected",
        "Personal agents interpreted preferences with the model."
      )
    );

    snapshot.status = "SEARCHING";
    await reporter.begin({
      phase: "SEARCHING",
      agent: negotiatorProgress()
    });
    await push(event("restaurant.search.started", "Searching nearby restaurants..."));

    const area = searchAreaFromEvent(councilEvent);
    const searchRequest = buildSearchRequest(area, constraints);
    let candidates: RestaurantCandidate[] = [];
    if (restaurants.discover) {
      candidates = await restaurants.discover(searchRequest, negotiator);
    } else {
      candidates = await restaurants.search(
        {
          eventId,
          latitude: area.latitude,
          longitude: area.longitude,
          radiusKm: area.radiusMeters / 1000,
          cuisines: searchRequest.cuisines,
          maxPriceLevel: searchRequest.required?.maxPriceLevel ??
            (searchRequest.priceLevels ? Math.max(...searchRequest.priceLevels) : undefined)
        },
        negotiator
      );
    }

    candidates = keepKnownMedia(candidates, deps.previousSnapshot);
    await reporter.begin({
      phase: "SEARCHING",
      step: "Checking restaurant hours",
      agent: negotiatorProgress()
    });
    const hoursResult = await retainCandidatesByHours({
      candidates,
      event: councilEvent,
      restaurants,
      principal: negotiator,
      previous: deps.previousSnapshot?.candidates
    });
    for (const [metric, value] of Object.entries(hoursResult.metrics)) {
      if (value) console.info(JSON.stringify({ metric, count: value }));
    }
    candidates = hoursResult.kept;
    if (candidates.length === 0) {
      throw new AppError(
        ErrorCodes.NOT_FOUND,
        hoursResult.eliminated.length
          ? `Nearby restaurants are closed or closing too soon for ${councilEvent.date ? "this event time" : "the search"}. Try a different time or a larger area.`
          : `No restaurants found near ${area.displayName}. Try a larger radius or different area.`,
        404
      );
    }

    snapshot.candidates = candidates;
    if (dietary) {
      await reporter.begin({
        phase: "SEARCHING",
        step: "Checking published dietary information",
        agent: negotiatorProgress()
      });
      await push(event("dietary.analysis.started", "Checking published dietary information..."));
      candidates = keepKnownMedia(
        await attachDietaryAssessments({
          candidates,
          constraints,
          analyzer: dietary,
          depth: "basic"
        }),
        deps.previousSnapshot
      );
      snapshot.candidates = candidates;
    }
    for (const candidate of candidates) {
      await push(
        event("restaurant.candidate.added", candidate.name, {
          candidateId: candidate.id,
          name: candidate.name,
          priceLevel: candidate.priceLevel
        })
      );
    }

    snapshot.status = "EVALUATING";
    const evaluations: CandidateEvaluation[] = [];

    for (const participant of participants) {
      const principal = createPersonalAgentPrincipal({
        userId: participant.userId,
        eventId
      });
      await reporter.begin({
        phase: "EVALUATING",
        step: `${participant.displayName}'s agent is scoring restaurants`,
        agent: personalAgentProgress(participant.displayName, participant.userId)
      });
      const batch = await evaluateCandidates({
        principal,
        candidates,
        constraints,
        runtime
      });
      for (const evaluation of batch) {
        const candidate = candidates.find((item) => item.id === evaluation.candidateId);
        if (!candidate) continue;
        evaluations.push(evaluation);
        if (evaluation.rejected) {
          await push(
            event(
              "candidate.rejected",
              evaluation.privateConflict
                ? `${candidate.name} — private constraint conflict`
                : `${candidate.name} — constraint conflict`,
              {
                candidateId: candidate.id,
                participantId: participant.userId,
                reasonCode: evaluation.reasonCode,
                label: evaluation.label
              }
            )
          );
        } else {
          await push(
            event("candidate.evaluated", `${candidate.name}: ${evaluation.label}`, {
              candidateId: candidate.id,
              participantId: participant.userId,
              score: evaluation.score,
              label: evaluation.label,
              reasonCode: evaluation.reasonCode
            })
          );
        }
      }
    }

    snapshot.evaluations = evaluations;
    snapshot.status = "NEGOTIATING";
    await reporter.begin({
      phase: "NEGOTIATING",
      agent: negotiatorProgress()
    });
    await push(event("negotiation.round.started", "Negotiator is ranking options."));

    const viableCount = new Set(
      evaluations.filter((item) => !item.rejected).map((item) => item.candidateId)
    ).size;

    if (viableCount < 2) {
      const extraRequest = {
        ...searchRequest,
        radiusMeters: Math.min(50_000, Math.round(searchRequest.radiusMeters * 1.5)),
        cuisines: searchRequest.required?.cuisines,
        relaxation: [...(searchRequest.relaxation ?? []), "Expanded radius for more options"]
      };
      const extra = restaurants.discover
        ? await restaurants.discover(extraRequest, negotiator)
        : await restaurants.search(
            {
              eventId,
              latitude: area.latitude,
              longitude: area.longitude,
              radiusKm: extraRequest.radiusMeters / 1000,
              maxPriceLevel: 4
            },
            negotiator
          );
      const known = new Set(candidates.map((item) => item.id));
      let additions: RestaurantCandidate[] = extra.filter((item) => !known.has(item.id));
      if (dietary && additions.length) {
        await reporter.begin({
          phase: "NEGOTIATING",
          step: "Checking dietary information on new options",
          agent: negotiatorProgress()
        });
        additions = await attachDietaryAssessments({
          candidates: additions,
          constraints,
          analyzer: dietary,
          depth: "basic"
        });
      }
      candidates.push(...keepKnownMedia(additions, deps.previousSnapshot));
      snapshot.candidates = candidates;
      for (const participant of participants) {
        const principal = createPersonalAgentPrincipal({
          userId: participant.userId,
          eventId
        });
        await reporter.begin({
          phase: "NEGOTIATING",
          step: `${participant.displayName}'s agent is scoring new options`,
          agent: personalAgentProgress(participant.displayName, participant.userId)
        });
        const extraEvals = await evaluateCandidates({
          principal,
          candidates: additions,
          constraints,
          runtime
        });
        evaluations.push(...extraEvals);
      }
      snapshot.evaluations = evaluations;
    }

    if (dietary) {
      const deepTargets = promisingForDeepDietary(candidates);
      if (deepTargets.length) {
        await reporter.begin({
          phase: "NEGOTIATING",
          step: "Checking dietary details on promising restaurants",
          agent: negotiatorProgress()
        });
        const deep = await attachDietaryAssessments({
          candidates: deepTargets,
          constraints,
          analyzer: dietary,
          restaurants,
          principal: negotiator,
          depth: "deep"
        });
        const byId = new Map(deep.map((item) => [item.id, item]));
        candidates = keepKnownMedia(
          candidates.map((candidate) => byId.get(candidate.id) ?? candidate),
          deps.previousSnapshot
        );
        snapshot.candidates = candidates;
        evaluations.length = 0;
        for (const participant of participants) {
          const principal = createPersonalAgentPrincipal({
            userId: participant.userId,
            eventId
          });
          await reporter.begin({
            phase: "NEGOTIATING",
            step: `${participant.displayName}'s agent is re-scoring after dietary details`,
            agent: personalAgentProgress(participant.displayName, participant.userId)
          });
          const batch = await evaluateCandidates({
            principal,
            candidates,
            constraints,
            runtime
          });
          evaluations.push(...batch);
        }
        snapshot.evaluations = evaluations;
      }
    }

    await reporter.begin({
      phase: "NEGOTIATING",
      step: "Negotiator is ranking options",
      agent: negotiatorProgress()
    });
    const recommendations = await negotiate({
      principal: negotiator,
      eventId,
      constraints,
      candidates,
      evaluations,
      runtime
    });

    await reporter.begin({
      phase: "NEGOTIATING",
      step: "Loading restaurant details",
      agent: negotiatorProgress()
    });
    for (const recommendation of recommendations.slice(0, 5)) {
      try {
        const details = await restaurants.getRestaurant(
          recommendation.candidate.id,
          negotiator
        );
        recommendation.candidate = mergeRestaurantMedia(details, recommendation.candidate);
      } catch {
        // Keep the discovery-level candidate if details lookup fails.
      }
    }

    snapshot.recommendations = recommendations;
    const enriched = new Map(recommendations.map((item) => [item.candidate.id, item.candidate]));
    snapshot.candidates = keepKnownMedia(
      candidates.map((candidate) =>
        mergeRestaurantMedia(enriched.get(candidate.id) ?? candidate, candidate)
      ),
      deps.previousSnapshot
    );
    snapshot.recommendations = recommendations.map((recommendation) => ({
      ...recommendation,
      candidate: mergeRestaurantMedia(
        snapshot.candidates.find((item) => item.id === recommendation.candidate.id) ??
          recommendation.candidate,
        recommendation.candidate
      )
    }));
    for (const recommendation of recommendations) {
      await push(
        event(
          "recommendation.updated",
          recommendation.rejected
            ? `${recommendation.candidate.name} was set aside`
            : `${recommendation.candidate.name} scored ${recommendation.councilScore}%`,
          {
            candidateId: recommendation.candidate.id,
            councilScore: recommendation.councilScore,
            rejected: recommendation.rejected,
            rejectionSummary: recommendation.rejectionSummary,
            explanations: recommendation.explanations,
            evaluations: recommendation.evaluations
          }
        )
      );
    }

    snapshot.status = "COMPLETE";
    await reporter.complete("COMPLETE");
    await push(event("council.completed", "The Council has a recommendation."));
    await deps.audit({
      principal: negotiator,
      action: "COUNCIL_COMPLETED",
      eventId,
      decision: "ALLOW"
    });
    await deps.persist(snapshot);
    return snapshot;
  } catch (error) {
    snapshot.status = "FAILED";
    snapshot.error = error instanceof Error ? error.message : "Council failed";
    await reporter.complete("FAILED", "Council could not complete");
    await push(event("council.failed", "Council could not complete."));
    await deps.persist(snapshot);
    throw error;
  }
}
