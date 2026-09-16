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
  }, [state.chat.length]);

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
            name={
              item.sender.type === "user"
                ? names.get(item.sender.userId) ?? "Member"
                : "Restaurant Council"
            }
            restaurant={item.relatedRestaurantId ? restaurants.get(item.relatedRestaurantId) : undefined}
            onDelete={
              item.sender.type === "user" && item.sender.userId === user.id && !item.deletedAt
                ? () => void api.deleteChat(eventId, item.id).then(() => refresh())
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
          placeholder="Write a message…"
          rows={3}
        />
        <button className="btn" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function ChatBubble({
  message,
  mine,
  name,
  restaurant,
  onDelete
}: {
  message: ChatMessage;
  mine: boolean;
  name: string;
  restaurant?: string;
  onDelete?: () => void;
}) {
  const system = message.sender.type !== "user";
  return (
    <div className={`chat-bubble ${system ? "council" : mine ? "mine" : ""}`}>
      <strong>{name}</strong>
      {restaurant ? <div className="muted">Re: {restaurant}</div> : null}
      <p>{message.deletedAt ? "(deleted)" : message.text}</p>
      {onDelete ? (
        <button className="btn ghost" type="button" onClick={onDelete}>
          Delete
        </button>
      ) : null}
    </div>
  );
}
