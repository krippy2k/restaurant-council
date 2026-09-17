import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FormError } from "../FormError";
import {
  api,
  type EventCreationIntent,
  type EventCreationResult,
  type EventSearchArea
} from "../api";
import { rememberDevAccounts } from "../dev-accounts";

const RADIUS_MILES = [2, 5, 10, 15];
const EXAMPLE =
  "Find somewhere kid friendly within 10 miles of Bamford Park Saturday at 3pm. Invite sarah@example.com.";

function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

type EventFormState = {
  name: string;
  date: string;
  query: string;
  radiusMiles: number;
  searchArea?: EventSearchArea;
};

function formFromIntent(
  intent: EventCreationIntent,
  command?: EventCreationResult["command"]
): EventFormState {
  return {
    name: intent.title || command?.name || "Dinner",
    date: intent.date ? `${intent.date}T${intent.time?.time ?? "19:00"}` : "",
    query: intent.location?.resolvedLocation?.displayName ?? intent.location?.query ?? "",
    radiusMiles: intent.location?.radiusMiles ?? command?.radiusMiles ?? 5,
    searchArea: command?.searchArea
  };
}

export function NewEventPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"describe" | "review" | "form">("describe");
  const [prompt, setPrompt] = useState("");
  const [changeText, setChangeText] = useState("");
  const [result, setResult] = useState<EventCreationResult>();
  const [form, setForm] = useState<EventFormState>({
    name: "Dinner Saturday",
    date: "",
    query: "Brickell, Miami",
    radiusMiles: 5
  });
  const [suggestions, setSuggestions] = useState<Array<{ displayName: string; placeId?: string }>>(
    []
  );
  const [error, setError] = useState<unknown>();
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);

  const radiusOptions = useMemo(() => {
    if (RADIUS_MILES.includes(form.radiusMiles)) return RADIUS_MILES;
    return [...RADIUS_MILES, form.radiusMiles].sort((a, b) => a - b);
  }, [form.radiusMiles]);

  function openForm(next: EventFormState = form) {
    setForm(next);
    setMode("form");
  }

  async function interpret(text: string) {
    setBusy(true);
    setError(undefined);
    try {
      const data = await api.interpretEvent(text, timezone());
      applyResult(data.result, text);
    } catch (err) {
      setError(err);
      openForm();
    } finally {
      setBusy(false);
    }
  }

  async function modify(text: string, current: EventCreationIntent) {
    setBusy(true);
    setError(undefined);
    try {
      const data = await api.modifyEventIntent(current, text, timezone());
      applyResult(data.result, prompt);
      setChangeText("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function applyResult(next: EventCreationResult, sourceText: string) {
    setResult(next);
    setPrompt(sourceText);
    if (next.fallbackToForm) {
      openForm(formFromIntent(next.intent, next.command));
      return;
    }
    setMode("review");
  }

  async function confirm() {
    if (!result?.intent) return;
    setBusy(true);
    setError(undefined);
    try {
      const data = await api.createEventFromIntent(result.intent, timezone());
      rememberDevAccounts(
        (data.invitations ?? []).map((invitation) => ({ email: invitation.email }))
      );
      navigate(`/events/${data.event.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function lookup(query: string, radiusMiles: number, placeId?: string) {
    if (!query.trim()) return;
    setLookingUp(true);
    setError(undefined);
    try {
      const data = await api.resolveLocation(query.trim(), radiusMiles, placeId);
      setForm((current) => ({
        ...current,
        query: data.searchArea.displayName,
        searchArea: data.searchArea
      }));
      setSuggestions([]);
    } catch (err) {
      setForm((current) => ({ ...current, searchArea: undefined }));
      setError(err);
    } finally {
      setLookingUp(false);
    }
  }

  async function onQueryChange(value: string) {
    setForm((current) => ({ ...current, query: value, searchArea: undefined }));
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const data = await api.suggestLocations(value.trim());
      setSuggestions(data.suggestions.slice(0, 6));
    } catch {
      setSuggestions([]);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      let area = form.searchArea;
      if (!area) {
        const data = await api.resolveLocation(form.query.trim(), form.radiusMiles);
        area = data.searchArea;
      } else if (area.radiusMeters !== Math.round(form.radiusMiles * 1609.34)) {
        area = { ...area, radiusMeters: Math.round(form.radiusMiles * 1609.34) };
      }
      const data = await api.createEvent({
        name: form.name,
        date: form.date ? new Date(form.date).toISOString() : undefined,
        timezone: timezone(),
        locationLabel: area.displayName,
        searchArea: area,
        radiusMiles: form.radiusMiles
      });
      navigate(`/events/${data.event.id}`);
    } catch (err) {
      setError(err);
    }
  }

  const candidates = (result?.intent.ambiguities ?? [])
    .flatMap((item) => item.candidates ?? [])
    .filter((item): item is { displayName: string } =>
      Boolean(item && typeof item === "object" && "displayName" in item)
    );

  if (mode === "form") {
    return (
      <form className="panel stack" onSubmit={(event) => void onSubmit(event)}>
        <p className="kicker">Host</p>
        <h1>Create an event</h1>
        {prompt ? <p className="muted">Your description is still here if you want to go back: “{prompt}”</p> : null}
        <label className="field">
          <span>Name</span>
          <input
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            required
          />
        </label>
        <label className="field">
          <span>Date</span>
          <input
            type="datetime-local"
            value={form.date}
            onChange={(e) => setForm((current) => ({ ...current, date: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>Where should we eat?</span>
          <input
            value={form.query}
            onChange={(e) => void onQueryChange(e.target.value)}
            onBlur={() => {
              if (form.query.trim() && !form.searchArea) void lookup(form.query, form.radiusMiles);
            }}
            placeholder="Brickell, Miami"
            required
          />
        </label>
        {suggestions.length > 0 ? (
          <div className="stack">
            {suggestions.map((item) => (
              <button
                key={`${item.displayName}-${item.placeId ?? ""}`}
                className="btn secondary"
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void lookup(item.displayName, form.radiusMiles, item.placeId)}
              >
                {item.displayName}
              </button>
            ))}
          </div>
        ) : null}
        <label className="field">
          <span>Search radius</span>
          <select
            value={form.radiusMiles}
            onChange={(e) => setForm((current) => ({ ...current, radiusMiles: Number(e.target.value) }))}
          >
            {radiusOptions.map((miles) => (
              <option key={miles} value={miles}>
                {miles} miles
              </option>
            ))}
          </select>
        </label>
        {form.searchArea ? (
          <p className="muted">
            Searching near {form.searchArea.displayName} ({form.searchArea.latitude.toFixed(4)},{" "}
            {form.searchArea.longitude.toFixed(4)}) · {(form.searchArea.radiusMeters / 1609.34).toFixed(0)} miles
          </p>
        ) : (
          <p className="muted">{lookingUp ? "Resolving location…" : "We'll confirm the map pin before saving."}</p>
        )}
        <FormError error={error} />
        <div className="btn-row">
          <button className="btn" type="submit" disabled={lookingUp}>
            Open the event
          </button>
          <button className="btn secondary" type="button" onClick={() => setMode(prompt ? "review" : "describe")}>
            Back to description
          </button>
        </div>
      </form>
    );
  }

  if (mode === "review" && result) {
    return (
      <div className="panel stack">
        <p className="kicker">Host</p>
        <h1>Create an event</h1>
        {result.questions.length ? (
          <div className="stack">
            {result.questions.map((question) => (
              <p key={question}>{question}</p>
            ))}
            {candidates.length ? (
              <div className="stack">
                {candidates.map((item) => (
                  <button
                    key={item.displayName}
                    className="btn secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void modify(`Near ${item.displayName}`, result.intent)}
                  >
                    {item.displayName}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <pre className="confirm-summary">{result.summary}</pre>
        )}
        <FormError error={error} />
        {result.errors.length ? (
          <p className="error">{result.errors.map((item) => item.message).join(" ")}</p>
        ) : null}
        <label className="field">
          <span>Make changes</span>
          <textarea
            value={changeText}
            onChange={(e) => setChangeText(e.target.value)}
            placeholder="Actually make it 5 miles and 4pm."
          />
        </label>
        <div className="btn-row">
          {result.readyToCreate ? (
            <button className="btn" type="button" disabled={busy} onClick={() => void confirm()}>
              Create Event
            </button>
          ) : null}
          <button
            className="btn secondary"
            type="button"
            disabled={busy || !changeText.trim()}
            onClick={() => void modify(changeText, result.intent)}
          >
            Make Changes
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => openForm(formFromIntent(result.intent, result.command))}
          >
            Edit using form
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="panel stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (prompt.trim()) void interpret(prompt.trim());
      }}
    >
      <p className="kicker">Host</p>
      <h1>Create an event</h1>
      <label className="field">
        <span>Describe what you're looking for</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={EXAMPLE}
          required
        />
      </label>
      <FormError error={error} />
      <div className="btn-row">
        <button className="btn" type="submit" disabled={busy || !prompt.trim()}>
          Continue
        </button>
        <button className="btn ghost" type="button" onClick={() => openForm()}>
          Use the form instead
        </button>
      </div>
    </form>
  );
}
