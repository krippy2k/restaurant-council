import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  type ChatMessage,
  type CollaborationState,
  type PreferencePrompt,
  type User
} from "../api";
import { FormError } from "../FormError";

const empty: CollaborationState = {
  chat: [],
  tasks: [],
  evidence: [],
  decisions: [],
  actions: [],
  prompts: []
};

export function EventChat({
  eventId,
  user,
  names,
  restaurants,
  discussingId,
  onDiscussed
}: {
  eventId: string;
  user: User;
  names: Map<string, string>;
  restaurants: Map<string, string>;
  discussingId?: string;
  onDiscussed?: () => void;
}) {
  const [state, setState] = useState<CollaborationState>(empty);
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>();
  const log = useRef<HTMLDivElement>(null);

  async function refresh() {
    const data = await api.collaboration(eventId);
    setState(data);
  }

  useEffect(() => {
    refresh().catch(setError);
  }, [eventId]);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/events/${eventId}/council/ws`);
    socket.onmessage = (message) => {
      const payload = JSON.parse(message.data) as { type?: string; message?: ChatMessage };
      if (payload.type === "chat" || payload.type === "collaboration" || payload.type === "snapshot") {
        void refresh();
      }
    };
    return () => socket.close();
  }, [eventId]);

  useEffect(() => {
    const el = log.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.chat.length, state.chat.at(-1)?.text, state.chat.at(-1)?.cards?.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    try {
      await api.postChat(eventId, text.trim(), discussingId);
      setText("");
      onDiscussed?.();
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function answer(prompt: PreferencePrompt, accepted: boolean) {
    try {
      await api.respondPreferencePrompt(eventId, prompt.id, accepted);
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="panel stack chat-panel">
      <h2>Event chat</h2>
      <div className="chat-log" ref={log}>
        {state.chat.map((item) => (
          <ChatBubble
            key={item.id}
            message={item}
            mine={item.sender.type === "user" && item.sender.userId === user.id}
            name={senderName(item, names)}
            restaurant={
              item.relatedRestaurantId ? restaurants.get(item.relatedRestaurantId) : undefined
            }
            restaurants={restaurants}
            onDelete={
              item.sender.type === "user" && item.sender.userId === user.id && !item.deletedAt
                ? () => void api.deleteChat(eventId, item.id).then(() => refresh())
                : undefined
            }
            onRetry={
              item.sender.type === "agent" &&
              item.relatedAgentInvocationId &&
              /retry/i.test(item.text ?? "")
                ? () =>
                    void api
                      .retryAgent(eventId, item.relatedAgentInvocationId as string)
                      .then(() => refresh())
                      .catch(setError)
                : undefined
            }
            onVerify={
              item.offerVerification
                ? () =>
                    void api
                      .requestVerification(eventId, item.offerVerification!.restaurantId, {
                        question: item.offerVerification!.question,
                        requirementType: item.offerVerification!.requirementType,
                        requirementValue: item.offerVerification!.requirementValue
                      })
                      .then(() => refresh())
                      .catch(setError)
                : undefined
            }
          />
        ))}
      </div>
      {state.prompts
        .filter((item) => item.status === "pending")
        .map((prompt) => (
          <div key={prompt.id} className="chat-confirm">
            <p>{prompt.question}</p>
            <div className="btn-row">
              <button className="btn" type="button" onClick={() => void answer(prompt, true)}>
                Yes
              </button>
              <button className="btn secondary" type="button" onClick={() => void answer(prompt, false)}>
                No
              </button>
            </div>
          </div>
        ))}
      <FormError error={error} />
      <form className="chat-compose" onSubmit={(event) => void send(event)}>
        {discussingId ? (
          <p className="muted">Discussing: {restaurants.get(discussingId) ?? "a restaurant"}</p>
        ) : null}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message, or ask @agent…"
          rows={2}
        />
        <button className="btn chat-send" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function senderName(message: ChatMessage, names: Map<string, string>): string {
  if (message.sender.type === "user") return names.get(message.sender.userId) ?? "Member";
  if (message.sender.type === "agent") return "Restaurant Agent";
  return "Restaurant Council";
}

function ChatBubble({
  message,
  mine,
  name,
  restaurant,
  restaurants,
  onDelete,
  onRetry,
  onVerify
}: {
  message: ChatMessage;
  mine: boolean;
  name: string;
  restaurant?: string;
  restaurants: Map<string, string>;
  onDelete?: () => void;
  onRetry?: () => void;
  onVerify?: () => void;
}) {
  const agent = message.sender.type === "agent";
  const system = message.sender.type !== "user";
  return (
    <div className={`chat-bubble ${agent ? "agent" : system ? "council" : mine ? "mine" : ""}`}>
      <strong>{name}</strong>
      {restaurant ? <div className="muted">Re: {restaurant}</div> : null}
      <p>{message.deletedAt ? "(deleted)" : message.text}</p>
      {!message.deletedAt && message.cards?.length
        ? message.cards.map((card, index) => (
            <ResearchCard key={`${card.type}-${index}`} card={card} restaurants={restaurants} />
          ))
        : null}
      {onVerify && message.offerVerification ? (
        <button className="btn" type="button" onClick={onVerify}>
          I&apos;ll call to verify
        </button>
      ) : null}
      {onRetry ? (
        <button className="btn secondary" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      {onDelete ? (
        <button className="btn ghost" type="button" onClick={onDelete}>
          Delete
        </button>
      ) : null}
    </div>
  );
}

function ResearchCard({
  card,
  restaurants
}: {
  card: NonNullable<ChatMessage["cards"]>[number];
  restaurants: Map<string, string>;
}) {
  const restaurant = restaurants.get(card.restaurantId);
  if (card.type === "menu-item") {
    return (
      <article className="research-card">
        <strong>{card.item.name}</strong>
        {card.item.description ? <p>{card.item.description}</p> : null}
        <p>
          {card.item.price != null
            ? `$${card.item.price.toFixed(2)}`
            : "Current price could not be confirmed"}
        </p>
        {restaurant ? <p className="muted">{restaurant}</p> : null}
        <p className="muted">
          Source: {card.sourceName ?? "Menu"}
          {card.checkedAt ? ` · ${checkedLabel(card.checkedAt)}` : ""}
        </p>
        {safeUrl(card.sourceUrl) ? (
          <a href={safeUrl(card.sourceUrl)} target="_blank" rel="noreferrer">
            View source
          </a>
        ) : null}
      </article>
    );
  }
  if (card.type === "reservation-link") {
    const href = safeUrl(card.url);
    return (
      <article className="research-card">
        <strong>Online reservations available</strong>
        <p className="muted">This is not a live availability check.</p>
        {href ? (
          <a className="btn" href={href} target="_blank" rel="noreferrer">
            {card.label}
          </a>
        ) : null}
      </article>
    );
  }
  return (
    <article className="research-card">
      <strong>{card.label}</strong>
      <p>{card.value}</p>
      {card.sourceName ? <p className="muted">Source: {card.sourceName}</p> : null}
    </article>
  );
}

function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

function checkedLabel(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 2) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return `Checked ${hours} hour${hours === 1 ? "" : "s"} ago`;
}
