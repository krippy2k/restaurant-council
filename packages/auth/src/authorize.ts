import { AppError, ErrorCodes } from "@rc/shared";
import { hasCapability } from "./capabilities.ts";
import type { AuthzDecision, AuthzRequest, Principal } from "./types.ts";

function allow(reason = "allow"): AuthzDecision {
  return { allowed: true, code: "ALLOW", reason };
}

function denyUser(reason: string): AuthzDecision {
  return { allowed: false, code: "FORBIDDEN", reason };
}

function denyAgent(reason: string): AuthzDecision {
  return { allowed: false, code: "AGENT_CAPABILITY_DENIED", reason };
}

function deny(principal: Principal, reason: string): AuthzDecision {
  if (principal.type === "personal_agent" || principal.type === "negotiator") {
    return denyAgent(reason);
  }
  return denyUser(reason);
}

function isEventMember(
  principalUserId: string,
  resource: { ownerId: string; memberIds: string[] }
): boolean {
  return (
    principalUserId === resource.ownerId || resource.memberIds.includes(principalUserId)
  );
}

export function authorize(request: AuthzRequest): AuthzDecision {
  const { principal, action, resource } = request;

  if (principal.type === "system") {
    return allow("system");
  }

  switch (action) {
    case "event.read": {
      if (resource.type !== "event") return deny(principal, "invalid_resource");
      if (principal.type === "user") {
        return isEventMember(principal.userId, resource)
          ? allow("event_member")
          : denyUser("not_event_member");
      }
      if (principal.type === "personal_agent" || principal.type === "negotiator") {
        return principal.eventId === resource.eventId
          ? allow("agent_event_scope")
          : denyAgent("event_scope_mismatch");
      }
      return deny(principal, "principal_denied");
    }
    case "event.update":
    case "event.invite":
    case "event.membership.manage":
    case "event.start_council":
    case "event.delete": {
      if (resource.type !== "event") return deny(principal, "invalid_resource");
      if (principal.type === "user" && principal.userId === resource.ownerId) {
        return allow("event_owner");
      }
      return deny(principal, "owner_required");
    }
    case "preference.public.read": {
      if (resource.type !== "preference") return deny(principal, "invalid_resource");
      if (resource.visibility !== "PUBLIC") {
        return deny(principal, "not_public");
      }
      if (principal.type === "user") {
        return allow("public_preference");
      }
      if (principal.type === "personal_agent" || principal.type === "negotiator") {
        return principal.eventId === resource.eventId
          ? allow("public_preference_agent")
          : denyAgent("event_scope_mismatch");
      }
      return deny(principal, "principal_denied");
    }
    case "preference.own.write": {
      if (resource.type !== "preference") return deny(principal, "invalid_resource");
      if (principal.type === "user" && principal.userId === resource.userId) {
        return allow("owner");
      }
      return deny(principal, "not_preference_owner");
    }
    case "preference.private.read":
    case "preference.private.write": {
      if (resource.type !== "preference") return deny(principal, "invalid_resource");
      if (resource.visibility !== "PRIVATE") {
        return deny(principal, "not_private");
      }

      // Structural deny: the Negotiator is never a Preference Service client,
      // even if a capability list is incorrectly constructed.
      if (principal.type === "negotiator") {
        return denyAgent("negotiator_cannot_access_private_preferences");
      }

      if (principal.type === "user") {
        return principal.userId === resource.userId
          ? allow("owner")
          : denyUser("not_preference_owner");
      }

      if (principal.type === "personal_agent") {
        const neededAction = action === "preference.private.read" ? "read" : "write";
        if (
          !hasCapability(principal, "preferences", neededAction, resource.userId)
        ) {
          return denyAgent("missing_capability");
        }
        if (principal.actingFor !== resource.userId) {
          return denyAgent("not_acting_for_owner");
        }
        if (principal.eventId !== resource.eventId) {
          return denyAgent("event_scope_mismatch");
        }
        return allow("personal_agent_owner_scope");
      }

      return deny(principal, "principal_denied");
    }
    case "constraint.read": {
      if (resource.type !== "constraint") return deny(principal, "invalid_resource");
      if (principal.type === "user") {
        return allow("member_constraints");
      }
      if (principal.type === "negotiator") {
        return hasCapability(principal, "constraints", "read", resource.eventId) &&
          principal.eventId === resource.eventId
          ? allow("negotiator_constraints")
          : denyAgent("missing_capability");
      }
      if (principal.type === "personal_agent") {
        return principal.eventId === resource.eventId
          ? allow("personal_agent_event_constraints")
          : denyAgent("event_scope_mismatch");
      }
      return deny(principal, "principal_denied");
    }
    case "constraint.write": {
      if (resource.type !== "constraint") return deny(principal, "invalid_resource");
      if (principal.type === "personal_agent") {
        return hasCapability(principal, "constraints", "write", resource.eventId) &&
          principal.eventId === resource.eventId
          ? allow("personal_agent_constraints")
          : denyAgent("missing_capability");
      }
      return deny(principal, "personal_agent_required");
    }
    case "restaurant.search":
    case "restaurant.get": {
      if (resource.type !== "restaurant") return deny(principal, "invalid_resource");
      const toolAction = action === "restaurant.search" ? "search" : "get";
      if (principal.type === "user") {
        return allow("user_search");
      }
      if (principal.type === "personal_agent" || principal.type === "negotiator") {
        return hasCapability(principal, "restaurants", toolAction)
          ? allow("agent_restaurant_tool")
          : denyAgent("missing_capability");
      }
      return deny(principal, "principal_denied");
    }
    case "negotiation.write": {
      if (resource.type !== "negotiation") return deny(principal, "invalid_resource");
      if (principal.type === "negotiator") {
        return hasCapability(principal, "negotiation", "write", resource.eventId) &&
          principal.eventId === resource.eventId
          ? allow("negotiator")
          : denyAgent("missing_capability");
      }
      return deny(principal, "negotiator_required");
    }
    case "audit.read": {
      if (resource.type !== "audit") return deny(principal, "invalid_resource");
      if (principal.type === "user" && isEventMember(principal.userId, resource)) {
        return allow("event_member");
      }
      return deny(principal, "not_event_member");
    }
    case "chat.read":
    case "chat.write":
    case "collaboration.act": {
      if (resource.type !== "event") return deny(principal, "invalid_resource");
      if (principal.type === "user") {
        return isEventMember(principal.userId, resource)
          ? allow("event_member")
          : denyUser("not_event_member");
      }
      if (principal.type === "personal_agent" || principal.type === "negotiator") {
        return principal.eventId === resource.eventId
          ? allow("agent_event_scope")
          : denyAgent("event_scope_mismatch");
      }
      return deny(principal, "principal_denied");
    }
    case "collaboration.moderate": {
      if (resource.type !== "event") return deny(principal, "invalid_resource");
      if (principal.type === "user" && principal.userId === resource.ownerId) {
        return allow("event_owner");
      }
      return deny(principal, "owner_required");
    }
    default:
      return deny(principal, "unknown_action");
  }
}

export function assertAuthorized(request: AuthzRequest): void {
  const decision = authorize(request);
  if (decision.allowed) return;
  if (decision.code === "AGENT_CAPABILITY_DENIED") {
    throw new AppError(
      ErrorCodes.AGENT_CAPABILITY_DENIED,
      decision.reason,
      403
    );
  }
  throw new AppError(ErrorCodes.FORBIDDEN, decision.reason, 403);
}
