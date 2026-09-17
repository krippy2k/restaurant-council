export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function addHours(iso: string, hours: number): string {
  return addMinutes(iso, hours * 60);
}

export function addMinutes(iso: string, minutes: number): string {
  const date = new Date(iso);
  date.setTime(date.getTime() + minutes * 60 * 1000);
  return date.toISOString();
}

export function isExpired(iso: string, now = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}
