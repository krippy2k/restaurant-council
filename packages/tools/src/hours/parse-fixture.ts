import type { WeeklyOpeningPeriod } from "../domain.ts";

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};

function parseClock(value: string): { hour: number; minute: number } | undefined {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const mer = match[3].toLowerCase();
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

function expandDays(raw: string | undefined): number[] {
  if (!raw || /^daily|every day|everyday$/i.test(raw.trim())) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  const parts = raw.toLowerCase().split(/\s*[–-]\s*/);
  const start = DAY_INDEX[parts[0]?.trim() ?? ""];
  const end = DAY_INDEX[parts[1]?.trim() ?? ""];
  if (start == null) return [0, 1, 2, 3, 4, 5, 6];
  if (end == null) return [start];
  const days: number[] = [];
  let day = start;
  for (let i = 0; i < 7; i += 1) {
    days.push(day);
    if (day === end) break;
    day = (day + 1) % 7;
  }
  return days;
}

function periodForDays(
  days: number[],
  open: { hour: number; minute: number },
  close: { hour: number; minute: number } | undefined
): WeeklyOpeningPeriod[] {
  return days.map((day) => {
    if (!close) return { open: { day, hour: open.hour, minute: open.minute } };
    let closeDay = day;
    const openMinutes = open.hour * 60 + open.minute;
    const closeMinutes = close.hour * 60 + close.minute;
    if (closeMinutes <= openMinutes) closeDay = (day + 1) % 7;
    return {
      open: { day, hour: open.hour, minute: open.minute },
      close: { day: closeDay, hour: close.hour, minute: close.minute }
    };
  });
}

export function parseFixtureHours(hours: string | undefined): WeeklyOpeningPeriod[] | undefined {
  const raw = hours?.trim();
  if (!raw) return undefined;
  if (/24\s*hours|open\s*24/i.test(raw)) {
    return [{ open: { day: 0, hour: 0, minute: 0 } }];
  }
  const periods: WeeklyOpeningPeriod[] = [];
  const chunks = raw.split(/\s*(?:,|;|\/)\s*/);
  for (const chunk of chunks) {
    const match = chunk.match(
      /^(?:(daily|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s*[–-]\s*(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))?\s+)?(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)$/i
    );
    if (!match) continue;
    const days = expandDays(match[1] && match[2] ? `${match[1]}–${match[2]}` : match[1]);
    const open = parseClock(match[3] ?? "");
    const close = parseClock(match[4] ?? "");
    if (!open) continue;
    periods.push(...periodForDays(days, open, close));
  }
  return periods.length ? periods : undefined;
}
