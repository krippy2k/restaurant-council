import type { Preference } from "./types.ts";

/**
 * Other participants must not learn that a private preference exists —
 * not the value, and not the category.
 */
export function sanitizePreferenceForViewer(
  preference: Preference,
  viewerUserId: string
): Preference | null {
  if (preference.visibility === "PUBLIC") {
    return preference;
  }
  if (preference.userId === viewerUserId) {
    return preference;
  }
  return null;
}

const SECRECY_SOURCES = [
  String.raw`\b(don't|dont|do not)\s+tell\b`,
  String.raw`\b(don't|dont|do not)\s+(let|share with)\s+(anybody|anyone|everybody|everyone|the (group|table|others))\b`,
  String.raw`\bkeep (this|it|that) (a )?secret\b`,
  String.raw`\bkeep (this|it|that) private\b`,
  String.raw`\bkeep (this|it|that) quiet\b`,
  String.raw`\bkeep quiet about\b`,
  String.raw`\bbetween us\b`,
  String.raw`\bbetween you and me\b`,
  String.raw`\boff the record\b`,
  String.raw`\bnot (for|to) the (group|table|others)\b`,
  String.raw`\b(hide|secret) (this|it) from\b`,
  String.raw`\bkeep it to yourself\b`
];

/** Character spans where notes ask not to share a preference with the group. */
export function secrecyLanguageSpans(text: string): { index: number; end: number }[] {
  const lower = text.toLowerCase().replaceAll("’", "'");
  const spans: { index: number; end: number }[] = [];
  for (const source of SECRECY_SOURCES) {
    for (const match of lower.matchAll(new RegExp(source, "gi"))) {
      if (match.index === undefined) continue;
      spans.push({ index: match.index, end: match.index + match[0].length });
    }
  }
  return spans.sort((left, right) => left.index - right.index);
}

/** True when notes ask the agent not to share the preference with the group. */
export function textRequestsSecrecy(text: string): boolean {
  return secrecyLanguageSpans(text).length > 0;
}
