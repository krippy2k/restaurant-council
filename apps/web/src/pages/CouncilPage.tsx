import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FormError } from "../FormError";
import { api, type CollaborationState, type CouncilSnapshot, type Member, type User } from "../api";
import { councilScoreFor, whyNotRecommended } from "../also-considered";
import { CouncilProgress } from "../components/CouncilProgress";
import { EvaluationBars } from "../components/EvaluationBars";
import { EventChat } from "../components/EventChat";
import { RestaurantActions } from "../components/RestaurantActions";
import { RestaurantCard } from "../components/RestaurantCard";
import { RestaurantDetails } from "../components/RestaurantDetails";
import {
  constraintPriorityLabel,
  constraintTypeLabel,
  formatConstraintDetail
} from "../rejection-reasons";

export function CouncilPage({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<CouncilSnapshot | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [agentsReady, setAgentsReady] = useState<boolean | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [collab, setCollab] = useState<CollaborationState>();
  const [discussingId, setDiscussingId] = useState<string>();

  useEffect(() => {
    api
      .event(eventId)
      .then((data) => {
        setMembers(data.members);
        setIsOwner(data.event.ownerId === user.id);
      })
      .catch(setError);
    api.council(eventId).then((data) => setSnapshot(data.snapshot)).catch(setError);
    api.collaboration(eventId).then(setCollab).catch(() => undefined);
    api
      .health()
      .then((data) => setAgentsReady(data.agents === "llm"))
      .catch(() => setAgentsReady(false));
  }, [eventId, user.id]);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/events/${eventId}/council/ws`);
    socket.onmessage = (message) => {
      const payload = JSON.parse(message.data) as { snapshot?: CouncilSnapshot; type?: string };
      if (payload.snapshot) setSnapshot(payload.snapshot);
      if (payload.type === "chat" || payload.type === "collaboration" || payload.type === "collaboration.updated") {
        void api.collaboration(eventId).then(setCollab);
      }
    };
    return () => socket.close();
  }, [eventId]);

  async function clearCache() {
    if (
      !window.confirm(
        "Clear stored Places search, hours, details, photos, and dietary assessments? The next Council run will call Google again."
      )
    ) {
      return;
    }
    setClearingCache(true);
    setError(undefined);
    try {
      await api.clearPlacesCache(eventId);
    } catch (err) {
      setError(err);
    } finally {
      setClearingCache(false);
    }
  }

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const data = await api.startCouncil(eventId);
      setSnapshot(data.snapshot);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.displayName ?? member.email ?? "Member");
    }
    if (snapshot) {
      for (const participant of snapshot.participants) {
        map.set(participant.userId, participant.displayName);
      }
    }
    return map;
  }, [members, snapshot]);

  const restaurants = useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of snapshot?.candidates ?? []) map.set(candidate.id, candidate.name);
    return map;
  }, [snapshot]);

  function taskFor(restaurantId: string) {
    return collab?.tasks.find(
      (task) =>
        task.restaurantId === restaurantId && (task.status === "open" || task.status === "claimed")
    );
  }

  function decisionFor(restaurantId: string) {
    return collab?.decisions.find((item) => item.restaurantId === restaurantId && item.userId === user.id);
  }

  const recommendations = useMemo(() => {
    return [...(snapshot?.recommendations ?? [])].sort((left, right) => {
      if (left.rejected !== right.rejected) return left.rejected ? 1 : -1;
      return right.councilScore - left.councilScore;
    });
  }, [snapshot]);

  const councilRunning =
    busy ||
    Boolean(
      snapshot?.progress &&
        !snapshot.progress.completedAt &&
        snapshot.status !== "COMPLETE" &&
        snapshot.status !== "FAILED" &&
        snapshot.status !== "CREATED"
    );

  const alsoConsidered = useMemo(() => {
    if (!snapshot || snapshot.status !== "COMPLETE") return [];
    const picked = new Set(snapshot.recommendations.map((item) => item.candidate.id));
    return snapshot.candidates
      .filter((candidate) => !picked.has(candidate.id))
      .map((candidate) => {
        const evaluations = snapshot.evaluations.filter((item) => item.candidateId === candidate.id);
        return {
          candidate,
          evaluations,
          score: evaluations.length ? councilScoreFor(evaluations) : undefined
        };
      })
      .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
      .slice(0, 8);
  }, [snapshot]);

  const publicConstraints = useMemo(() => {
    const items = (snapshot?.constraints ?? []).filter(
      (constraint) => constraint.visibility === "PUBLIC"
    );
    const groups = new Map<string, typeof items>();
    for (const constraint of items) {
      const list = groups.get(constraint.participantId) ?? [];
      list.push(constraint);
      groups.set(constraint.participantId, list);
    }
    return [...groups.entries()].sort(([left], [right]) =>
      (names.get(left) ?? left).localeCompare(names.get(right) ?? right)
    );
  }, [names, snapshot]);

  function reasonsFor(restaurantId: string) {
    if (!snapshot) return [];
    const restaurant = snapshot.candidates.find((item) => item.id === restaurantId);
    if (!restaurant) return [];
    const decisions =
      collab?.decisions.filter(
        (item) => item.restaurantId === restaurantId && item.visibility !== "private"
      ) ?? [];
    return whyNotRecommended({
      restaurant,
      evaluations: snapshot.evaluations.filter((item) => item.candidateId === restaurantId),
      constraints: snapshot.constraints,
      topScores: snapshot.recommendations.map((item) => item.councilScore),
      hasOpenVerification: Boolean(taskFor(restaurantId)),
      publicDislike: decisions.some((item) => item.decision === "dislike"),
      publicReject: decisions.some((item) => item.decision === "reject")
    });
  }

  return (
    <div>
      <p className="kicker">Live session</p>
      <div className="section-head">
        <h1>The Council</h1>
        <div className="nav-row">
          <Link className="btn secondary" to={`/events/${eventId}`}>
            Back to event
          </Link>
          {isOwner ? (
            <button
              className="btn"
              disabled={
                busy ||
                agentsReady !== true ||
                Boolean(
                  snapshot?.progress &&
                    !snapshot.progress.completedAt &&
                    snapshot.status !== "COMPLETE" &&
                    snapshot.status !== "FAILED" &&
                    snapshot.status !== "CREATED"
                )
              }
              onClick={() => void start()}
            >
              {busy ||
              (snapshot?.progress &&
                !snapshot.progress.completedAt &&
                snapshot.status !== "COMPLETE" &&
                snapshot.status !== "FAILED")
                ? "In session…"
                : "Start Council"}
            </button>
          ) : null}
        </div>
      </div>
      <FormError error={error} />
      <CouncilProgress
        snapshot={snapshot}
        starting={busy}
        onClearCache={isOwner ? () => void clearCache() : undefined}
        clearingCache={clearingCache}
      />
      {agentsReady === false ? (
        <p className="error">
          Council agents are not configured. Add OPENAI_API_KEY to .dev.vars at the
          repo root and restart the API. GET /api/health should then report
          agents: llm.
        </p>
      ) : null}
      <p className="muted">
        {agentsReady
          ? "Personal agents and the Negotiator will call the configured model."
          : null}{" "}
        {snapshot
          ? `Council is ${snapshot.status.toLowerCase().replaceAll("_", " ")}. ${snapshot.candidates.length} restaurants considered.`
          : "No session yet. The host can start one after everyone has added preferences."}
      </p>

      <div className="grid-2">
        <section className="stack">
          {recommendations.map((recommendation) => (
            <RestaurantDetails
              key={recommendation.candidate.id}
              recommendation={recommendation}
              names={names}
              constraints={snapshot?.constraints ?? []}
            >
              <RestaurantActions
                eventId={eventId}
                restaurantId={recommendation.candidate.id}
                restaurantName={recommendation.candidate.name}
                phone={recommendation.candidate.phone}
                email={recommendation.candidate.email}
                task={taskFor(recommendation.candidate.id)}
                currentDecision={decisionFor(recommendation.candidate.id)?.decision}
                userId={user.id}
                names={names}
                onDiscuss={() => setDiscussingId(recommendation.candidate.id)}
                onChanged={() => void api.collaboration(eventId).then(setCollab)}
              />
            </RestaurantDetails>
          ))}
          {councilRunning ? (
            <div
              className={`candidate-grid${recommendations.length ? " after-picks" : ""}`}
            >
              <p className="evaluating-placeholder">Evaluating</p>
            </div>
          ) : alsoConsidered.length ? (
            <div
              className={`candidate-grid${recommendations.length ? " after-picks" : ""}`}
            >
              <h2>Also considered</h2>
              {alsoConsidered.map(({ candidate, evaluations, score }) => (
                <RestaurantCard
                  key={candidate.id}
                  restaurant={candidate}
                  compact
                  kicker={score != null ? `Council score ${score}%` : undefined}
                >
                  <EvaluationBars evaluations={evaluations} names={names} />
                  <div className="also-why">
                    <p className="also-why-label">Why it wasn&apos;t recommended</p>
                    <ul className="also-why-list">
                      {reasonsFor(candidate.id).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                  <RestaurantActions
                    eventId={eventId}
                    restaurantId={candidate.id}
                    restaurantName={candidate.name}
                    phone={candidate.phone}
                    email={candidate.email}
                    task={taskFor(candidate.id)}
                    currentDecision={decisionFor(candidate.id)?.decision}
                    userId={user.id}
                    names={names}
                    onDiscuss={() => setDiscussingId(candidate.id)}
                    onChanged={() => void api.collaboration(eventId).then(setCollab)}
                  />
                </RestaurantCard>
              ))}
            </div>
          ) : null}
        </section>
        <aside className="stack council-sidebar">
          <section className="panel">
            <h2>Public constraints</h2>
            <p className="muted">
              Private constraints stay with your Personal Agent. The group only
              sees a conflict when one affects a restaurant.
            </p>
            {publicConstraints.length ? (
              <div className="constraint-list">
                {publicConstraints.map(([userId, constraints]) => (
                  <section className="constraint-group" key={userId}>
                    <h3>{names.get(userId) ?? "Member"}</h3>
                    <ul>
                      {constraints.map((constraint) => (
                        <li key={constraint.id}>
                          <div className="constraint-type">{constraintTypeLabel(constraint.type)}</div>
                          <p>{formatConstraintDetail(constraint.type, constraint.value)}</p>
                          <p className="muted">{constraintPriorityLabel(constraint.priority)}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <p className="muted">None yet. Public preferences show up here after Council runs.</p>
            )}
          </section>
          <EventChat
            eventId={eventId}
            user={user}
            names={names}
            restaurants={restaurants}
            discussingId={discussingId}
            onDiscussed={() => setDiscussingId(undefined)}
          />
        </aside>
      </div>
    </div>
  );
}
