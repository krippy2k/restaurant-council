import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import {
  loadDevAccounts,
  onDevAccountsChange,
  rememberDevAccount,
  rememberDevAccounts,
  type DevAccount
} from "../dev-accounts";

export function DevUserSwitcher({
  user,
  onAuth
}: {
  user: User;
  onAuth: (user: User) => void;
}) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<DevAccount[]>(() => loadDevAccounts());
  const [pendingEmail, setPendingEmail] = useState<string>();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (user.email) rememberDevAccount({ email: user.email, displayName: user.displayName });
  }, [user.displayName, user.email]);

  useEffect(() => {
    return onDevAccountsChange(() => setAccounts(loadDevAccounts()));
  }, []);

  useEffect(() => {
    api
      .devIdentities()
      .then((data) => setAccounts(rememberDevAccounts(data.people)))
      .catch(() => undefined);
  }, [user.id]);

  const options = useMemo(() => {
    const map = new Map(accounts.map((item) => [item.email, item]));
    if (user.email) {
      map.set(user.email, {
        email: user.email,
        displayName: user.displayName ?? map.get(user.email)?.displayName
      });
    }
    return [...map.values()].sort((left, right) =>
      (left.displayName ?? left.email).localeCompare(right.displayName ?? right.email)
    );
  }, [accounts, user.displayName, user.email]);

  async function switchTo(email: string, name?: string) {
    if (!email || email === user.email) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.signin(email, name);
      if (result.needsDisplayName) {
        setPendingEmail(email);
        setDisplayName("");
        return;
      }
      if (!result.user) throw new Error("Sign-in failed");
      rememberDevAccount({ email: result.user.email ?? email, displayName: result.user.displayName });
      setPendingEmail(undefined);
      onAuth(result.user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch users");
    } finally {
      setBusy(false);
    }
  }

  async function submitName(event: FormEvent) {
    event.preventDefault();
    if (!pendingEmail || !displayName.trim()) return;
    await switchTo(pendingEmail, displayName.trim());
  }

  return (
    <div className="dev-switcher">
      <label>
        <span>View as</span>
        <select
          value={user.email ?? ""}
          disabled={busy}
          onChange={(event) => void switchTo(event.target.value)}
        >
          {options.map((account) => (
            <option key={account.email} value={account.email}>
              {account.displayName ? `${account.displayName} (${account.email})` : account.email}
            </option>
          ))}
        </select>
      </label>
      {pendingEmail ? (
        <form className="dev-switcher-name" onSubmit={(event) => void submitName(event)}>
          <p>Choose a display name for {pendingEmail}.</p>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Display name"
            autoFocus
            required
          />
          <button className="btn" type="submit" disabled={busy || !displayName.trim()}>
            Continue
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setPendingEmail(undefined);
              setError(undefined);
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
