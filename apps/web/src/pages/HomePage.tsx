import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FormError } from "../FormError";
import { api, type EventSummary, type User } from "../api";

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
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (!user) return;
    api.events().then((data) => setEvents(data.events)).catch(setError);
  }, [user]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      const data = await api.signin(email, displayName);
      onAuth(data.user);
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
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
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
      <div className="card-list">
        {events.length === 0 ? (
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
