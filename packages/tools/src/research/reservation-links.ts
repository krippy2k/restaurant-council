const PROVIDERS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: "opentable", label: "Reserve on OpenTable", pattern: /opentable\.com/i },
  { id: "resy", label: "Reserve on Resy", pattern: /resy\.com/i },
  { id: "tock", label: "Reserve on Tock", pattern: /exploretock\.com|tock\.com/i },
  { id: "sevenrooms", label: "Reserve on SevenRooms", pattern: /sevenrooms\.com/i }
];

export interface DiscoveredReservationLink {
  provider: string;
  url: string;
  label: string;
}

export function discoverReservationLinks(input: {
  links: string[];
  text?: string;
}): DiscoveredReservationLink[] {
  const found: DiscoveredReservationLink[] = [];
  const seen = new Set<string>();
  for (const url of input.links) {
    for (const provider of PROVIDERS) {
      if (!provider.pattern.test(url)) continue;
      const key = `${provider.id}:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ provider: provider.id, url, label: provider.label });
    }
  }
  return found;
}

export function reservationDoesNotImplyAvailability(note?: string): string {
  return (
    note ??
    "A reservation page was found. This does not mean a specific date, time, or party size is available."
  );
}
