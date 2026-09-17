import { DurableObject } from "cloudflare:workers";
import { createPersonalAgentPrincipal, createNegotiatorPrincipal, type PersonalAgentPrincipal, type Principal } from "@rc/auth";
import { deriveConstraints, verificationTasksFromCouncil } from "@rc/agents";
import { runCouncil, reevaluateCouncil, mergeRestaurantMedia, isStaleCouncilLock, CouncilSpendTracker, type CouncilDependencies } from "@rc/orchestration";
import {
  sanitizeCouncilSnapshotForClients,
  type CouncilClientEvent,
  type CouncilConstraint,
  type CouncilProgress,
  type CouncilSnapshot
} from "@rc/protocol";
import { AppError, ErrorCodes, nowIso } from "@rc/shared";
import { createRestaurantSearch, createDietaryAnalyzer } from "./restaurants.ts";
import { runtimeFromEnv } from "./ai.ts";
import { Database } from "./db/database.ts";
import { newAction, newChatMessage } from "./db/collaboration.ts";
import type { Env } from "./env.ts";
import { writeAudit } from "./services/audit.ts";
import { D1PreferenceVault } from "./services/preference-vault.ts";

export class CouncilDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      const snapshot = await this.clientSnapshot();
      if (snapshot) {
        pair[1].send(JSON.stringify({ type: "snapshot", snapshot }));
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/start")) {
      const body = (await request.json()) as { eventId?: string };
      if (!body.eventId) {
        return Response.json({ error: { code: "VALIDATION", message: "eventId required" } }, { status: 400 });
      }
      try {
        const snapshot = sanitizeCouncilSnapshotForClients(
          await this.execute(body.eventId)
        );
        return Response.json({ snapshot });
      } catch (error) {
        if (error instanceof AppError) {
          return Response.json(
            { error: { code: error.code, message: error.message } },
            { status: error.status }
          );
        }
        const message = error instanceof Error ? error.message : "Council failed";
        return Response.json({ error: { code: "INTERNAL", message } }, { status: 500 });
      }
    }

    if (request.method === "POST" && url.pathname.endsWith("/notify")) {
      const payload = (await request.json()) as Record<string, unknown>;
      this.broadcastRaw(payload);
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname.endsWith("/reevaluate")) {
      try {
        const body = (await request.json().catch(() => ({}))) as { refreshConstraints?: boolean };
        const snapshot = await this.reevaluate(Boolean(body.refreshConstraints));
        return Response.json({ snapshot: snapshot ? sanitizeCouncilSnapshotForClients(snapshot) : null });
      } catch (error) {
        if (error instanceof AppError) {
          return Response.json(
            { error: { code: error.code, message: error.message } },
            { status: error.status }
          );
        }
        const message = error instanceof Error ? error.message : "Re-evaluation failed";
        return Response.json({ error: { code: "INTERNAL", message } }, { status: 500 });
      }
    }

    if (request.method === "GET") {
      return Response.json({ snapshot: await this.clientSnapshot() });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(socket: WebSocket): Promise<void> {
    const snapshot = await this.clientSnapshot();
    if (snapshot) {
      socket.send(JSON.stringify({ type: "snapshot", snapshot }));
    }
  }

  private async clientSnapshot(): Promise<CouncilSnapshot | null> {
    const snapshot = await this.ctx.storage.get<CouncilSnapshot>("snapshot");
    return snapshot ? sanitizeCouncilSnapshotForClients(snapshot) : null;
  }

  private broadcast(snapshot: CouncilSnapshot, event?: CouncilClientEvent): void {
    const client = sanitizeCouncilSnapshotForClients(snapshot);
    const payload = JSON.stringify({
      type: event?.type ?? "snapshot",
      event,
      snapshot: client
    });
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(payload);
    }
  }

  private async publishProgress(snapshot: CouncilSnapshot, progress: CouncilProgress): Promise<void> {
    snapshot.progress = progress;
    const client = sanitizeCouncilSnapshotForClients(snapshot);
    await this.ctx.storage.put("snapshot", client);
    this.broadcast(client, {
      type: "council.progress",
      at: progress.startedAt,
      message: progress.detail ? `${progress.step} · ${progress.detail}` : progress.step
    });
  }

  private broadcastRaw(payload: Record<string, unknown>): void {
    const body = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(body);
    }
  }

  private async reevaluate(refreshConstraints = false): Promise<CouncilSnapshot | null> {
    const eventId = await this.ctx.storage.get<string>("eventId");
    const current = await this.ctx.storage.get<CouncilSnapshot>("snapshot");
    if (!eventId || !current) return current ?? null;
    let deferred = false;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.hasActiveRunLock()) {
        await this.ctx.storage.put("reevalPending", true);
        await this.ctx.storage.put(
          "reevalRefresh",
          refreshConstraints || Boolean(await this.ctx.storage.get("reevalRefresh"))
        );
        deferred = true;
        return;
      }
      await this.acquireRunLock();
    });
    if (deferred) return current;
    const started = Date.now();
    try {
      await this.publishProgress(current, {
        phase: "EVALUATING",
        step: "Re-evaluating after new information",
        stepIndex: 3,
        stepCount: 4,
        agent: { kind: "council", name: "Council" },
        startedAt: nowIso(),
        sessionStartedAt: nowIso()
      });
      const db = new Database(this.env.DB);
      const [decisions, evidence] = await Promise.all([
        db.collab.listDecisions(eventId),
        db.collab.listEvidence(eventId)
      ]);
      const spend = new CouncilSpendTracker();
      const constraints = refreshConstraints
        ? await this.refreshConstraints(db, current, spend)
        : current.constraints;
      const next = await reevaluateCouncil({
        snapshot: current,
        decisions,
        evidence,
        constraints,
        runtime: runtimeFromEnv(this.env, { onUsage: (usage) => spend.addAgent(usage) }),
        spend,
        reportProgress: (progress, snapshot) => this.publishProgress(snapshot, progress)
      });
      const restaurants = createRestaurantSearch(this.env, db, {
        onPlacesRequest: (request) => spend.addPlaces(request),
        onPlacesCacheHit: (kind) => spend.addPlacesCache(kind)
      });
      const negotiator = createNegotiatorPrincipal(eventId);
      for (const recommendation of next.recommendations.slice(0, 5)) {
        try {
          const details = await restaurants.getRestaurant(recommendation.candidate.id, negotiator);
          recommendation.candidate = mergeRestaurantMedia(details, recommendation.candidate);
        } catch {
          // Keep photos already on the candidate if details lookup fails.
        }
      }
      next.candidates = next.candidates.map((candidate) => {
        const richer = next.recommendations.find((item) => item.candidate.id === candidate.id)?.candidate;
        return richer ? mergeRestaurantMedia(richer, candidate) : candidate;
      });
      if (next.progress) next.progress = { ...next.progress, spend: spend.snapshot() };
      const client = sanitizeCouncilSnapshotForClients(next);
      await this.ctx.storage.put("snapshot", client);
      await db.saveCouncilSnapshot(client);
      await this.seedVerification(db, client);
      const message = newChatMessage({
        eventId,
        sender: { type: "council" },
        messageType: "council-update",
        text: "I've updated the Council evaluation."
      });
      await db.collab.insertChat(message);
      this.broadcast(client, {
        type: "collaboration.updated",
        at: nowIso(),
        message: message.text ?? "Council updated"
      });
      this.broadcastRaw({ type: "chat", message });
      console.info(JSON.stringify({ metric: "council_reevaluations_triggered", durationMs: Date.now() - started }));
      return next;
    } finally {
      await this.releaseRunLock();
      if (await this.ctx.storage.get<boolean>("reevalPending")) {
        const pendingRefresh = Boolean(await this.ctx.storage.get("reevalRefresh"));
        await this.ctx.storage.put("reevalPending", false);
        await this.ctx.storage.put("reevalRefresh", false);
        await this.reevaluate(pendingRefresh);
      }
    }
  }

  private async refreshConstraints(
    db: Database,
    snapshot: CouncilSnapshot,
    spend?: CouncilSpendTracker
  ): Promise<CouncilConstraint[]> {
    const runtime = runtimeFromEnv(this.env, spend ? { onUsage: (usage) => spend.addAgent(usage) } : undefined);
    const vault = new D1PreferenceVault(db);
    const publicPreferences = (await db.listPreferences(snapshot.eventId)).filter(
      (preference) => preference.visibility === "PUBLIC"
    );
    const constraints: CouncilConstraint[] = [];
    for (const participant of snapshot.participants) {
      const principal = createPersonalAgentPrincipal({
        userId: participant.userId,
        eventId: snapshot.eventId
      });
      const privateRecords = await vault.readPrivate(principal, participant.userId, snapshot.eventId);
      const derived = await deriveConstraints({
        principal,
        eventId: snapshot.eventId,
        publicPreferences,
        privateRecords,
        runtime
      });
      constraints.push(...derived);
    }
    await db.replaceConstraints(snapshot.eventId, constraints);
    return constraints;
  }

  private async seedVerification(db: Database, snapshot: CouncilSnapshot): Promise<void> {
    const existing = await db.collab.listTasks(snapshot.eventId);
    const tasks = verificationTasksFromCouncil({
      eventId: snapshot.eventId,
      candidates: snapshot.candidates,
      constraints: snapshot.constraints,
      evaluations: snapshot.evaluations,
      existing
    });
    for (const task of tasks) {
      await db.collab.upsertTask(task);
      const restaurant = snapshot.candidates.find((item) => item.id === task.restaurantId);
      const action = newAction({
        eventId: snapshot.eventId,
        restaurantId: task.restaurantId,
        type: "verification-requested",
        visibility: "event",
        payload: { taskId: task.id, question: task.question }
      });
      await db.collab.insertAction(action);
      const message = newChatMessage({
        eventId: snapshot.eventId,
        sender: { type: "council" },
        messageType: "verification-update",
        text:
          task.requirementType === "opening-hours"
            ? `⚠ Hours at ${restaurant?.name ?? "a restaurant"} could not be verified. ${task.question}`
            : `⚠ ${String(task.requirementValue ?? task.requirementType)} at ${restaurant?.name ?? "a restaurant"} is currently uncertain. ${task.question}`,
        relatedRestaurantId: task.restaurantId,
        relatedActionId: action.id
      });
      await db.collab.insertChat(message);
      this.broadcastRaw({ type: "chat", message });
      console.info(JSON.stringify({ metric: "verification_tasks_created" }));
    }
  }

  private async execute(eventId: string): Promise<CouncilSnapshot> {
    const spend = new CouncilSpendTracker();
    const runtime = runtimeFromEnv(this.env, { onUsage: (usage) => spend.addAgent(usage) });
    if (!runtime) {
      throw new AppError(
        ErrorCodes.AGENTS_NOT_CONFIGURED,
        "Council agents require OPENAI_API_KEY. Add it to .dev.vars at the repo root and restart the API.",
        503
      );
    }
    await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.hasActiveRunLock()) {
        throw new AppError(
          ErrorCodes.COUNCIL_IN_PROGRESS,
          "A Council session is already in progress. Watch the live workflow, or try again in a moment.",
          409
        );
      }
      await this.acquireRunLock();
      await this.ctx.storage.put("eventId", eventId);
      const existing = await this.ctx.storage.get<CouncilSnapshot>("snapshot");
      if (existing && (existing.status === "COMPLETE" || existing.status === "FAILED")) {
        existing.status = "DERIVING_CONSTRAINTS";
        existing.progress = {
          phase: "DERIVING_CONSTRAINTS",
          step: "Starting the Council",
          stepIndex: 1,
          stepCount: 4,
          startedAt: nowIso(),
          sessionStartedAt: nowIso()
        };
        await this.ctx.storage.put("snapshot", existing);
        this.broadcast(existing, {
          type: "council.progress",
          at: existing.progress.startedAt,
          message: existing.progress.step
        });
      }
    });

    const db = new Database(this.env.DB);
    const vault = new D1PreferenceVault(db);
    const restaurants = createRestaurantSearch(this.env, db, {
      onPlacesRequest: (request) => spend.addPlaces(request),
      onPlacesCacheHit: (kind) => spend.addPlacesCache(kind)
    });
    const dietary = createDietaryAnalyzer(this.env, db);

    const deps: CouncilDependencies = {
      getEvent: async (id) => {
        const event = await db.getEvent(id);
        if (!event) throw new AppError(ErrorCodes.NOT_FOUND, "Event not found", 404);
        return event;
      },
      listMembers: (id) => db.listMembers(id),
      getUser: async (id) => {
        const user = await db.getUser(id);
        if (!user) throw new AppError(ErrorCodes.NOT_FOUND, "User not found", 404);
        return user;
      },
      listPublicPreferences: async (id) => {
        const all = await db.listPreferences(id);
        return all.filter((preference) => preference.visibility === "PUBLIC");
      },
      readVaultForAgent: (
        principal: PersonalAgentPrincipal,
        userId: string,
        id: string
      ) => vault.readPrivate(principal, userId, id),
      saveConstraints: (constraints) => db.replaceConstraints(eventId, constraints),
      restaurants,
      dietary,
      runtime,
      spend,
      previousSnapshot: (await this.ctx.storage.get<CouncilSnapshot>("snapshot")) ?? undefined,
      emit: async (event, snapshot) => {
        const client = sanitizeCouncilSnapshotForClients(snapshot);
        await this.ctx.storage.put("snapshot", client);
        this.broadcast(client, event);
      },
      persist: async (snapshot) => {
        const client = sanitizeCouncilSnapshotForClients(snapshot);
        await this.ctx.storage.put("snapshot", client);
        await db.saveCouncilSnapshot(client);
      },
      reportProgress: (progress, snapshot) => this.publishProgress(snapshot, progress),
      audit: (input: {
        principal: Principal;
        action: string;
        resource?: string;
        decision: string;
        reason?: string;
        eventId?: string;
      }) => writeAudit(db, input)
    };

    try {
      const snapshot = await runCouncil(eventId, deps);
      await this.seedVerification(db, snapshot);
      const event = await db.getEvent(eventId);
      if (event) {
        await db.updateEvent({
          ...event,
          status: "decided",
          updatedAt: new Date().toISOString()
        });
      }
      return snapshot;
    } finally {
      await this.releaseRunLock();
    }
  }

  private async hasActiveRunLock(): Promise<boolean> {
    const running = await this.ctx.storage.get<boolean>("running");
    const runningStartedAt = await this.ctx.storage.get<number>("runningStartedAt");
    const snapshot = await this.ctx.storage.get<CouncilSnapshot>("snapshot");
    if (
      isStaleCouncilLock({
        running,
        runningStartedAt,
        snapshotStatus: snapshot?.status
      })
    ) {
      await this.releaseRunLock();
      return false;
    }
    return Boolean(running);
  }

  private async acquireRunLock(): Promise<void> {
    await this.ctx.storage.put("running", true);
    await this.ctx.storage.put("runningStartedAt", Date.now());
  }

  private async releaseRunLock(): Promise<void> {
    await this.ctx.storage.put("running", false);
    await this.ctx.storage.delete("runningStartedAt");
  }
}
