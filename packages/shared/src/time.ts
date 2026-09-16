export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function addHours(iso: string, hours: number): string {
  const date = new Date(iso);
  date.setTime(date.getTime() + hours * 60 * 60 * 1000);
  return date.toISOString();
}

export function isExpired(iso: string, now = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}
