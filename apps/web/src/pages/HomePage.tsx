import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FormError } from "../FormError";
import { api, type EventSummary, type PendingInvitation, type User } from "../api";
import { rememberDevAccount } from "../dev-accounts";

export function HomePage({
  user,
  onAuth
}: {
  user: User | null;
  onAuth: (user: User) => void;
}) {
  const [email, setEmail] = useState("gee@example.com");
  const [displayName, setDisplayName] = useState("Gee");
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [invites, setInvites] = useState<PendingInvitation[]>([]);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (!user) return;
    if (user.email) rememberDevAccount({ email: user.email, displayName: user.displayName });
    api.events().then((data) => setEvents(data.events)).catch(setError);
    api.pendingInvitations().then((data) => setInvites(data.invitations)).catch(() => undefined);
  }, [user]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      const data = await api.signin(email, displayName);
      if (!data.user) throw new Error("Sign-in failed");
      rememberDevAccount({ email: data.user.email ?? email, displayName: data.user.displayName });
      onAuth(data.user);
    } catch (err) {
      setError(err);
    }
  }

  async function acceptInvite(invitation: PendingInvitation) {
    setError(undefined);
    try {
      await api.acceptPendingInvitation(invitation.id);
      setInvites((current) => current.filter((item) => item.id !== invitation.id));
      const data = await api.events();
      setEvents(data.events);
    } catch (err) {
      setError(err);
    }
  }

  async function removeEvent(eventId: string, name: string) {
    if (
      !window.confirm(
        `Delete “${name}”? Preferences, chat, invitations, and Council results for it will be removed.`
      )
    ) {
      return;
    }
    setError(undefined);
    try {
      await api.deleteEvent(eventId);
      setEvents((current) => current.filter((item) => item.id !== eventId));
    } catch (err) {
      setError(err);
    }
  }

  if (!user) {
    return (
      <section className="hero">
        <div>
          <p className="kicker">A reference for multi-agent privacy</p>
          <h1>Choose dinner without exposing why someone said no.</h1>
          <p className="lede">
            Each guest has a Personal Agent that can read only their private
            preferences. A Negotiator searches real restaurants and ranks options
            from sanitized constraints — never from source text. Authorization
            lives in application code, not in a prompt.
          </p>
        </div>
        <form className="panel forest stack" onSubmit={(event) => void signIn(event)}>
          <h2>Take a seat</h2>
          <p>Local development sign-in. No password. Production can swap the identity provider.</p>
          <label className="field">
            <span>Display name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </label>
          <FormError error={error} />
          <button className="btn" type="submit">
            Sign in
          </button>
        </form>
      </section>
    );
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <p className="kicker">Your table</p>
          <h1>Events</h1>
        </div>
        <Link className="btn" to="/events/new">
          Create event
        </Link>
      </div>
      <FormError error={error} />
      {invites.length ? (
        <section className="stack invite-inbox">
          <h2>Invitations</h2>
          {invites.map((invitation) => (
            <article className="event-card" key={invitation.id}>
              <div>
                <p className="kicker">{invitation.inviterName} invited you</p>
                <h2>{invitation.eventName}</h2>
                <p className="muted">
                  {invitation.date ? new Date(invitation.date).toLocaleString() : "Date TBD"}
                  {invitation.locationLabel ? ` · ${invitation.locationLabel}` : ""}
                </p>
              </div>
              <button className="btn" type="button" onClick={() => void acceptInvite(invitation)}>
                Accept
              </button>
            </article>
          ))}
        </section>
      ) : null}
      <div className="card-list">
        {events.length === 0 && invites.length === 0 ? (
          <p className="muted">No events yet. Create one and invite the rest of the table.</p>
        ) : (
          events.map((event) => (
            <article className="event-card" key={event.id}>
              <Link to={`/events/${event.id}`}>
                <div className="kicker">{event.status.replaceAll("_", " ")}</div>
                <h2>{event.name}</h2>
                <p className="muted">
                  {event.date ? new Date(event.date).toLocaleString() : "Date TBD"}
                  {event.locationLabel ? ` · ${event.locationLabel}` : ""}
                </p>
              </Link>
              {event.ownerId === user.id ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => void removeEvent(event.id, event.name)}
                >
                  Delete
                </button>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
