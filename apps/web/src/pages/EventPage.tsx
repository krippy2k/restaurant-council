import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FormError } from "../FormError";
import {
  api,
  type AuthzDemo,
  type EventSummary,
  type Invitation,
  type Member,
  type Preference,
  type PreferenceNoteDraft,
  type User
} from "../api";
import { EventChat } from "../components/EventChat";
import { rememberDevAccount } from "../dev-accounts";

export function EventPage({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventSummary>();
  const [members, setMembers] = useState<Member[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("sarah@example.com");
  const [authz, setAuthz] = useState<AuthzDemo[]>([]);
  const [error, setError] = useState<unknown>();
  const [restaurants, setRestaurants] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const isOwner = event?.ownerId === user.id;

  async function refresh() {
    const [detail, prefs] = await Promise.all([
      api.event(eventId),
      api.preferences(eventId)
    ]);
    setEvent(detail.event);
    setMembers(detail.members);
    setPreferences(prefs.preferences);
    if (detail.event.ownerId === user.id) {
      const invites = await api.invitations(eventId);
      setInvitations(invites.invitations);
    }
    const council = await api.council(eventId).catch(() => undefined);
    if (council?.snapshot) {
      setRestaurants(
        new Map(council.snapshot.candidates.map((item) => [item.id, item.name]))
      );
    }
  }

  useEffect(() => {
    refresh().catch(setError);
  }, [eventId]);

  async function invite(form: FormEvent) {
    form.preventDefault();
    try {
      const result = await api.invite(eventId, inviteEmail);
      rememberDevAccount({ email: result.invitation.destination });
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function runDemo() {
    const data = await api.authorizationDemo(eventId);
    setAuthz(data.results);
  }

  async function removeEvent() {
    if (
      !window.confirm(
        "Delete this event? Preferences, chat, invitations, and Council results for it will be removed."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteEvent(eventId);
      navigate("/");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.displayName ?? member.email ?? "Member");
    }
    return map;
  }, [members]);

  if (!event) {
    return <p className="muted">Loading event…</p>;
  }

  return (
    <div>
      <p className="kicker">{event.status.replaceAll("_", " ")}</p>
      <div className="section-head">
        <h1>{event.name}</h1>
        <div className="nav-row">
          {isOwner ? (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => void removeEvent()}>
              Delete event
            </button>
          ) : null}
          <Link className="btn" to={`/events/${event.id}/council`}>
            Open Council
          </Link>
        </div>
      </div>
      <p className="muted">
        {event.date ? new Date(event.date).toLocaleString() : "Date TBD"}
        {event.locationLabel ? ` · ${event.locationLabel}` : ""}
        {event.searchArea
          ? ` · ${(event.searchArea.radiusMeters / 1609.34).toFixed(0)} mile radius`
          : ""}
      </p>
      <FormError error={error} />

      <div className="grid-2">
        <section>
          <div className="section-head">
            <h2>Members</h2>
          </div>
          {members.map((member) => (
            <div className="member-row" key={member.userId}>
              <strong>{member.displayName ?? member.email ?? member.userId}</strong>
              <div className="muted">
                {member.role} · {member.status}
              </div>
            </div>
          ))}
          {isOwner ? (
            <form className="panel stack" onSubmit={(formEvent) => void invite(formEvent)}>
              <h3>Invite by email</h3>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <button className="btn" type="submit">
                Send invitation
              </button>
              <p className="muted">
                They’ll see this invite when they sign in with that email. No code to paste.
              </p>
              {invitations.map((invitation) => (
                <div key={invitation.id} className="muted">
                  {invitation.destination} ·{" "}
                  {invitation.acceptedAt ? "accepted" : "pending"}
                </div>
              ))}
            </form>
          ) : null}
        </section>

        <PreferencePanel
          eventId={eventId}
          user={user}
          members={members}
          preferences={preferences}
          onChange={() => void refresh()}
          onError={setError}
        />
      </div>

      <EventChat eventId={eventId} user={user} names={names} restaurants={restaurants} />

      <section>
        <div className="section-head">
          <h2>Authorization demonstration</h2>
          <button className="btn secondary" onClick={() => void runDemo()}>
            Run boundary checks
          </button>
        </div>
        <p className="muted">
          These checks are enforced outside the model. A prompt injection cannot
          grant Sarah's private preferences to another guest, their agent, or the
          Negotiator.
        </p>
        <div className="authz">
          {authz.map((item) => (
            <div className="authz-item" key={item.name}>
              <div>
                <strong>{item.name}</strong>
                <div className="muted">{item.reason}</div>
              </div>
              <span className="pill warn code">{item.code}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type PrefFormState = {
  category: string;
  visibility: "PUBLIC" | "PRIVATE";
  priority: string;
  text: string;
  maxPriceLevel: string;
  cuisines: string;
  dietaryRequirement: string;
  dietaryStrength: "preferred" | "required";
  dietaryEvidence: "normal" | "strict";
};

const DIETARY_REQUIREMENTS = [
  "dairy-free",
  "gluten-free",
  "vegetarian",
  "vegan",
  "nut-free",
  "peanut-free",
  "shellfish-free",
  "egg-free",
  "soy-free",
  "halal",
  "kosher"
];

const DEFAULT_PREF_FORM: PrefFormState = {
  category: "price",
  visibility: "PRIVATE",
  priority: "HIGH",
  text: "",
  maxPriceLevel: "2",
  cuisines: "steak",
  dietaryRequirement: "vegetarian",
  dietaryStrength: "required",
  dietaryEvidence: "normal"
};

function formFromPreference(preference: Preference): PrefFormState {
  const value = preference.value ?? {};
  const list = value.cuisines ?? value.restrictions ?? value.allergens;
  const constraint = Array.isArray(value.constraints)
    ? (value.constraints[0] as {
        requirement?: string;
        strength?: string;
        evidenceRequirement?: string;
      } | undefined)
    : undefined;
  return {
    category: preference.category,
    visibility: preference.visibility,
    priority: preference.priority,
    text: preference.sourceText ?? (typeof value.text === "string" ? value.text : ""),
    maxPriceLevel: typeof value.maxPriceLevel === "number" ? String(value.maxPriceLevel) : "2",
    cuisines: Array.isArray(list) ? list.map(String).join(", ") : "steak",
    dietaryRequirement: String(constraint?.requirement ?? (Array.isArray(value.restrictions) ? value.restrictions[0] : "vegetarian")),
    dietaryStrength: constraint?.strength === "preferred" ? "preferred" : "required",
    dietaryEvidence: constraint?.evidenceRequirement === "strict" ? "strict" : "normal"
  };
}

function preferencePayload(form: PrefFormState) {
  const lists = form.cuisines.split(",").map((item) => item.trim()).filter(Boolean);
  const value =
    form.category === "price"
      ? { maxPriceLevel: Number(form.maxPriceLevel) }
      : form.category === "cuisine"
        ? { cuisines: lists }
        : form.category === "dietary"
          ? {
              restrictions: [form.dietaryRequirement],
              constraints: [
                {
                  requirement: form.dietaryRequirement,
                  strength: form.dietaryStrength,
                  evidenceRequirement: form.dietaryEvidence
                }
              ]
            }
          : form.category === "allergies"
            ? { allergens: lists }
            : { text: form.text };
  return {
    category: form.category,
    visibility: form.visibility,
    priority: form.dietaryStrength === "preferred" && form.category === "dietary" ? "MEDIUM" : form.priority,
    value,
    sourceText: form.text.trim() || undefined
  };
}

function PreferencePanel({
  eventId,
  user,
  members,
  preferences,
  onChange,
  onError
}: {
  eventId: string;
  user: User;
  members: Member[];
  preferences: Preference[];
  onChange: () => void;
  onError: (error: unknown) => void;
}) {
  const [createForm, setCreateForm] = useState<PrefFormState>(DEFAULT_PREF_FORM);
  const [addMode, setAddMode] = useState<"describe" | "form">("describe");
  const [notes, setNotes] = useState("");
  const [notesVisibility, setNotesVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [preview, setPreview] = useState<PreferenceNoteDraft[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PrefFormState>(DEFAULT_PREF_FORM);
  const [editError, setEditError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editingId && !dialog.open) dialog.showModal();
    if (!editingId && dialog.open) dialog.close();
  }, [editingId]);

  function closeEdit() {
    setEditingId(null);
    setEditError(undefined);
    setEditForm(DEFAULT_PREF_FORM);
  }

  function startEdit(preference: Preference) {
    setEditError(undefined);
    setEditForm(formFromPreference(preference));
    setEditingId(preference.id);
  }

  async function add(form: FormEvent) {
    form.preventDefault();
    setBusy(true);
    try {
      await api.addPreference(eventId, preferencePayload(createForm));
      setCreateForm(DEFAULT_PREF_FORM);
      onChange();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function interpretNotes(form: FormEvent) {
    form.preventDefault();
    if (!notes.trim()) return;
    setBusy(true);
    try {
      const data = await api.interpretPreferences(eventId, notes.trim(), notesVisibility);
      setPreview(data.drafts);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveDrafts() {
    if (!preview?.length) return;
    setBusy(true);
    try {
      for (const draft of preview) {
        await api.addPreference(eventId, {
          category: draft.category,
          visibility: draft.visibility,
          priority: draft.priority,
          value: draft.value,
          sourceText: draft.sourceText
        });
      }
      setNotes("");
      setPreview(null);
      onChange();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(form: FormEvent) {
    form.preventDefault();
    if (!editingId) return;
    setBusy(true);
    try {
      await api.updatePreference(eventId, editingId, preferencePayload(editForm));
      closeEdit();
      onChange();
    } catch (error) {
      setEditError(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(preferenceId: string) {
    if (!window.confirm("Delete this preference? It will not apply to the next Council run.")) {
      return;
    }
    setBusy(true);
    try {
      await api.deletePreference(eventId, preferenceId);
      if (editingId === preferenceId) closeEdit();
      onChange();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  function ownerName(id: string) {
    const member = members.find((item) => item.userId === id);
    return member?.displayName ?? member?.email ?? "Member";
  }

  return (
    <section>
      <div className="section-head">
        <h2>Preferences</h2>
      </div>
      <p className="muted">
        Describe what you need in your own words, or use the form. Changes apply
        the next time Council runs.
      </p>
      {preferences.map((preference) => (
        <article className="pref-card" key={preference.id}>
          <span className={`pill ${preference.visibility === "PRIVATE" ? "private" : "public"}`}>
            {preference.visibility === "PRIVATE"
              ? "Private — only your Personal Agent can see why"
              : "Public"}
          </span>
          <h3>
            {ownerName(preference.userId)} · {preference.category}
          </h3>
          <p className="muted">Priority {preference.priority}</p>
          {preference.value || preference.sourceText ? (
            <p>{preference.sourceText ?? JSON.stringify(preference.value)}</p>
          ) : null}
          {preference.userId === user.id ? (
            <div className="nav-row">
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => startEdit(preference)}
              >
                Edit
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={busy}
                onClick={() => void remove(preference.id)}
              >
                Delete
              </button>
            </div>
          ) : null}
        </article>
      ))}

      {addMode === "describe" ? (
        <form className="panel stack" onSubmit={(form) => void interpretNotes(form)}>
          <div className="section-head">
            <h3>Add a preference</h3>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setPreview(null);
                setAddMode("form");
              }}
            >
              Use the form
            </button>
          </div>
          <label className="field">
            <span>What should we keep in mind?</span>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setPreview(null);
              }}
              rows={4}
              placeholder="Dairy-free and under $30 — keep the budget quiet."
              required
            />
          </label>
          <label className="field">
            <span>Visibility</span>
            <select
              value={notesVisibility}
              onChange={(e) => setNotesVisibility(e.target.value as "PUBLIC" | "PRIVATE")}
            >
              <option value="PRIVATE">Private — only your Personal Agent can see why</option>
              <option value="PUBLIC">Public to the group</option>
            </select>
          </label>
          {notesVisibility === "PRIVATE" ? (
            <p className="muted">
              Private notes stay with your Personal Agent.
            </p>
          ) : (
            <p className="muted">
              Public to the group. Asking to keep it quiet makes the preference you
              just mentioned private.
            </p>
          )}
          {preview ? (
            <div className="stack">
              <p className="muted">We'll save:</p>
              {preview.map((draft, index) => (
                <article className="pref-card" key={`${draft.category}-${index}`}>
                  <span className={`pill ${draft.visibility === "PRIVATE" ? "private" : "public"}`}>
                    {draft.visibility === "PRIVATE" ? "Private" : "Public"}
                  </span>
                  <h3>{draft.summary}</h3>
                  <p className="muted">
                    {draft.category} · {draft.priority}
                  </p>
                </article>
              ))}
              <div className="nav-row">
                <button className="btn" type="button" disabled={busy} onClick={() => void saveDrafts()}>
                  Save these
                </button>
                <button className="btn secondary" type="submit" disabled={busy}>
                  Interpret again
                </button>
              </div>
            </div>
          ) : (
            <button className="btn" type="submit" disabled={busy || !notes.trim()}>
              {busy ? "Reading…" : "Interpret"}
            </button>
          )}
        </form>
      ) : (
        <form className="panel stack" onSubmit={(form) => void add(form)}>
          <div className="section-head">
            <h3>Add a preference</h3>
            <button className="btn ghost" type="button" onClick={() => setAddMode("describe")}>
              Use natural language
            </button>
          </div>
          <PreferenceFields form={createForm} onChange={setCreateForm} />
          <button className="btn" type="submit" disabled={busy}>
            Save preference
          </button>
        </form>
      )}

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="edit-pref-title"
        onClose={closeEdit}
        onClick={(event) => {
          const dialog = dialogRef.current;
          if (!dialog) return;
          const rect = dialog.getBoundingClientRect();
          const outside =
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom;
          if (outside) closeEdit();
        }}
      >
        <form className="modal-card stack" onSubmit={(form) => void saveEdit(form)}>
          <div className="section-head">
            <h2 id="edit-pref-title">Edit preference</h2>
            <button className="btn ghost" type="button" onClick={closeEdit}>
              Close
            </button>
          </div>
          <p className="muted">Changes apply the next time Council runs.</p>
          <FormError error={editError} />
          <PreferenceFields form={editForm} onChange={setEditForm} />
          <div className="nav-row">
            <button className="btn" type="submit" disabled={busy}>
              Save changes
            </button>
            <button className="btn ghost" type="button" onClick={closeEdit}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

function PreferenceFields({
  form,
  onChange
}: {
  form: PrefFormState;
  onChange: (next: PrefFormState) => void;
}) {
  return (
    <>
      <div className="grid-2">
        <label className="field">
          <span>Category</span>
          <select
            value={form.category}
            onChange={(e) => onChange({ ...form, category: e.target.value })}
          >
            <option value="price">Price</option>
            <option value="cuisine">Cuisine</option>
            <option value="dietary">Dietary</option>
            <option value="allergies">Allergies</option>
            <option value="freeform">Freeform</option>
          </select>
        </label>
        <label className="field">
          <span>Visibility</span>
          <select
            value={form.visibility}
            onChange={(e) =>
              onChange({ ...form, visibility: e.target.value as "PUBLIC" | "PRIVATE" })
            }
          >
            <option value="PRIVATE">Private</option>
            <option value="PUBLIC">Public</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Priority</span>
        <select
          value={form.priority}
          onChange={(e) => onChange({ ...form, priority: e.target.value })}
        >
          <option>LOW</option>
          <option>MEDIUM</option>
          <option>HIGH</option>
          <option>HARD</option>
        </select>
      </label>
      {form.category === "price" ? (
        <label className="field">
          <span>Max price level</span>
          <select
            value={form.maxPriceLevel}
            onChange={(e) => onChange({ ...form, maxPriceLevel: e.target.value })}
          >
            <option value="1">$ — under about $15</option>
            <option value="2">$$ — under about $30</option>
            <option value="3">$$$</option>
            <option value="4">$$$$</option>
          </select>
        </label>
      ) : form.category === "dietary" ? (
        <div className="stack">
          <label className="field">
            <span>Requirement</span>
            <select
              value={form.dietaryRequirement}
              onChange={(e) => onChange({ ...form, dietaryRequirement: e.target.value })}
            >
              {DIETARY_REQUIREMENTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Strength</span>
              <select
                value={form.dietaryStrength}
                onChange={(e) =>
                  onChange({
                    ...form,
                    dietaryStrength: e.target.value as "preferred" | "required"
                  })
                }
              >
                <option value="preferred">Preferred</option>
                <option value="required">Required</option>
              </select>
            </label>
            <label className="field">
              <span>Evidence</span>
              <select
                value={form.dietaryEvidence}
                onChange={(e) =>
                  onChange({
                    ...form,
                    dietaryEvidence: e.target.value as "normal" | "strict"
                  })
                }
              >
                <option value="normal">Normal</option>
                <option value="strict">Stricter published evidence</option>
              </select>
            </label>
          </div>
          <p className="muted">
            Stricter evidence asks the analyzer to rely on official restaurant
            information. You do not have to explain why.
          </p>
        </div>
      ) : (
        <label className="field">
          <span>{form.category === "cuisine" ? "Cuisines" : "Details"}</span>
          <input
            value={form.cuisines}
            onChange={(e) => onChange({ ...form, cuisines: e.target.value })}
          />
        </label>
      )}
      <label className="field">
        <span>Why / notes</span>
        <textarea
          value={form.text}
          onChange={(e) => onChange({ ...form, text: e.target.value })}
        />
      </label>
      {form.visibility === "PRIVATE" ? (
        <p className="muted">
          Private — only your Personal Agent can see why. The Negotiator receives a
          derived constraint, not this text.
        </p>
      ) : (
        <p className="muted">
          Public to the group. If your notes ask not to tell anyone, the agent will
          keep the derived constraint private anyway.
        </p>
      )}
    </>
  );
}
