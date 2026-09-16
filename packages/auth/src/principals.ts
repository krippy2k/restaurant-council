import { negotiatorCapabilities, personalAgentCapabilities } from "./capabilities.ts";
import type {
  NegotiatorPrincipal,
  PersonalAgentPrincipal,
  SystemPrincipal,
  UserPrincipal
} from "./types.ts";

export function createUserPrincipal(userId: string): UserPrincipal {
  return { type: "user", userId };
}

export function createPersonalAgentPrincipal(input: {
  userId: string;
  eventId: string;
}): PersonalAgentPrincipal {
  return {
    type: "personal_agent",
    agentId: `agent_personal_${input.eventId}_${input.userId}`,
    agentType: "personal",
    actingFor: input.userId,
    eventId: input.eventId,
    capabilities: personalAgentCapabilities(input.userId, input.eventId)
  };
}

export function createNegotiatorPrincipal(eventId: string): NegotiatorPrincipal {
  return {
    type: "negotiator",
    agentId: `agent_negotiator_${eventId}`,
    agentType: "negotiator",
    eventId,
    capabilities: negotiatorCapabilities(eventId)
  };
}

export function createSystemPrincipal(service: string): SystemPrincipal {
  return { type: "system", service };
}
