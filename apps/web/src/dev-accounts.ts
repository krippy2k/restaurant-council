export type DevAccount = { email: string; displayName?: string };

const KEY = "rc_dev_accounts";
const EVENT = "rc-dev-accounts";

function normalize(account: DevAccount): DevAccount | undefined {
  const email = account.email.trim().toLowerCase();
  if (!email.includes("@")) return undefined;
  const displayName = account.displayName?.trim();
  return { email, displayName: displayName || undefined };
}

export function loadDevAccounts(): DevAccount[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as DevAccount[];
    if (!Array.isArray(raw)) return [];
    const map = new Map<string, DevAccount>();
    for (const item of raw) {
      const next = normalize(item);
      if (!next) continue;
      map.set(next.email, {
        email: next.email,
        displayName: next.displayName ?? map.get(next.email)?.displayName
      });
    }
    return [...map.values()];
  } catch {
    return [];
  }
}

export function rememberDevAccounts(accounts: DevAccount[]): DevAccount[] {
  const map = new Map(loadDevAccounts().map((item) => [item.email, item]));
  for (const account of accounts) {
    const next = normalize(account);
    if (!next) continue;
    const prior = map.get(next.email);
    map.set(next.email, {
      email: next.email,
      displayName: next.displayName ?? prior?.displayName
    });
  }
  const merged = [...map.values()];
  localStorage.setItem(KEY, JSON.stringify(merged));
  window.dispatchEvent(new Event(EVENT));
  return merged;
}

export function rememberDevAccount(account: DevAccount): DevAccount[] {
  return rememberDevAccounts([account]);
}

export function onDevAccountsChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
