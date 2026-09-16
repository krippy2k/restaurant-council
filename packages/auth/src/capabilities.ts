import type { Capability, Principal } from "./types.ts";

export function hasCapability(
  principal: Principal,
  resource: string,
  action: string,
  scope?: string
): boolean {
  if (principal.type !== "personal_agent" && principal.type !== "negotiator") {
    return false;
  }
  return principal.capabilities.some(
    (capability) =>
      capability.resource === resource &&
      capability.action === action &&
      (capability.scope === undefined || capability.scope === scope)
  );
}

export function personalAgentCapabilities(
  userId: string,
  eventId: string
): Capability[] {
  return [
    { resource: "preferences", action: "read", scope: userId },
    { resource: "preferences", action: "write", scope: userId },
    { resource: "constraints", action: "write", scope: eventId },
    { resource: "restaurants", action: "search" },
    { resource: "restaurants", action: "get" },
    { resource: "evaluations", action: "write", scope: eventId }
  ];
}

export function negotiatorCapabilities(eventId: string): Capability[] {
  return [
    { resource: "constraints", action: "read", scope: eventId },
    { resource: "restaurants", action: "search" },
    { resource: "restaurants", action: "get" },
    { resource: "negotiation", action: "write", scope: eventId }
  ];
}
