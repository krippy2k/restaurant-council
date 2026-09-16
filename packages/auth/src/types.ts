export interface Identity {
  userId: string;
  email?: string;
  phone?: string;
  displayName?: string;
}

export interface IdentityProvider {
  getIdentity(request: Request): Promise<Identity | null>;
}

export interface Capability {
  resource: string;
  action: string;
  scope?: string;
}

export interface UserPrincipal {
  type: "user";
  userId: string;
}

export interface PersonalAgentPrincipal {
  type: "personal_agent";
  agentId: string;
  agentType: "personal";
  actingFor: string;
  eventId: string;
  capabilities: Capability[];
}

export interface NegotiatorPrincipal {
  type: "negotiator";
  agentId: string;
  agentType: "negotiator";
  eventId: string;
  capabilities: Capability[];
}

export interface SystemPrincipal {
  type: "system";
  service: string;
}

export type Principal =
  | UserPrincipal
  | PersonalAgentPrincipal
  | NegotiatorPrincipal
  | SystemPrincipal;

export const ACTIONS = [
  "event.read",
  "event.update",
  "event.invite",
  "event.membership.manage",
  "event.start_council",
  "event.delete",
  "preference.public.read",
  "preference.own.write",
  "preference.private.read",
  "preference.private.write",
  "constraint.read",
  "constraint.write",
  "restaurant.search",
  "restaurant.get",
  "negotiation.write",
  "audit.read",
  "chat.read",
  "chat.write",
  "collaboration.act",
  "collaboration.moderate"
] as const;

export type Action = (typeof ACTIONS)[number];

export type Resource =
  | {
      type: "event";
      eventId: string;
      ownerId: string;
      memberIds: string[];
    }
  | {
      type: "preference";
      preferenceId?: string;
      userId: string;
      eventId: string;
      visibility: "PUBLIC" | "PRIVATE";
    }
  | {
      type: "constraint";
      eventId: string;
    }
  | {
      type: "restaurant";
    }
  | {
      type: "negotiation";
      eventId: string;
    }
  | {
      type: "audit";
      eventId: string;
      ownerId: string;
      memberIds: string[];
    };

export interface AuthzRequest {
  principal: Principal;
  action: Action;
  resource: Resource;
}

export interface AuthzDecision {
  allowed: boolean;
  code: "ALLOW" | "FORBIDDEN" | "AGENT_CAPABILITY_DENIED";
  reason: string;
}
