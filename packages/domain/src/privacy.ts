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

/** True when notes ask the agent not to share the preference with the group. */
export function textRequestsSecrecy(text: string): boolean {
  const lower = text.toLowerCase().replaceAll("’", "'");
  return (
    /\b(don't|dont|do not)\s+tell\b/.test(lower) ||
    /\b(don't|dont|do not)\s+(let|share with)\s+(anybody|anyone|everybody|everyone|the (group|table|others))\b/.test(
      lower
    ) ||
    /\bkeep (this|it|that) (a )?secret\b/.test(lower) ||
    /\bkeep (this|it|that) private\b/.test(lower) ||
    /\bbetween us\b/.test(lower) ||
    /\bbetween you and me\b/.test(lower) ||
    /\boff the record\b/.test(lower) ||
    /\bnot (for|to) the (group|table|others)\b/.test(lower) ||
    /\b(hide|secret) (this|it) from\b/.test(lower) ||
    /\bkeep it to yourself\b/.test(lower)
  );
}
