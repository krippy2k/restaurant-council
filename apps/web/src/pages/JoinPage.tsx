import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FormError } from "../FormError";
import { api, type User } from "../api";

export function JoinPage({
  user,
  onAuth
}: {
  user: User | null;
  onAuth: (user: User) => void;
}) {
  const [params] = useSearchParams();
  const token = params.get("invite") ?? "";
  const navigate = useNavigate();
  const [preview, setPreview] = useState<{
    event: { name?: string; date?: string; locationLabel?: string };
    inviterName: string;
  }>();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (!token) return;
    api.previewInvite(token).then(setPreview).catch(setError);
  }, [token]);

  async function join(form: FormEvent) {
    form.preventDefault();
    try {
      let current = user;
      if (!current) {
      const signed = await api.signin(email, displayName);
      if (!signed.user) throw new Error("Sign-in failed");
      onAuth(signed.user);
      current = signed.user;
      }
      const accepted = await api.acceptInvite(token);
      navigate(`/events/${accepted.eventId}`);
    } catch (err) {
      setError(err);
    }
  }

  if (!token) return <p className="error">Missing invitation token.</p>;
  if (!preview) return <p className="muted">Opening invitation…</p>;

  return (
    <section className="panel stack">
      <p className="kicker">Invitation</p>
      <h1>{preview.inviterName} invited you to</h1>
      <h2>{preview.event.name}</h2>
      <p className="muted">
        {preview.event.date ? new Date(preview.event.date).toLocaleString() : "Date TBD"}
        {preview.event.locationLabel ? ` · ${preview.event.locationLabel}` : ""}
      </p>
      <form className="stack" onSubmit={(form) => void join(form)}>
        {!user ? (
          <>
            <label className="field">
              <span>Your name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
          </>
        ) : (
          <p>Signed in as {user.displayName ?? user.email}</p>
        )}
        <FormError error={error} />
        <button className="btn" type="submit">
          Join the Council
        </button>
      </form>
    </section>
  );
}
