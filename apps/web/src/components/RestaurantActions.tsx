import { useState } from "react";
import {
  api,
  type CompleteVerificationInput,
  type DecisionInput,
  type VerificationTask
} from "../api";
import { phoneHref } from "../restaurant-display";

const REJECT_REASONS = [
  ["dietary", "Dietary concern"],
  ["price", "Too expensive"],
  ["distance", "Too far away"],
  ["cuisine", "Don't like the cuisine"],
  ["been-before", "Been there before"],
  ["previous-experience", "Bad previous experience"],
  ["accessibility", "Accessibility concern"],
  ["other", "Other"]
] as const;

export function RestaurantActions({
  eventId,
  restaurantId,
  restaurantName,
  phone,
  email,
  task,
  currentDecision,
  userId,
  names,
  onDiscuss,
  onChanged
}: {
  eventId: string;
  restaurantId: string;
  restaurantName: string;
  phone?: string;
  email?: string;
  task?: VerificationTask;
  currentDecision?: DecisionInput["decision"];
  userId: string;
  names: Map<string, string>;
  onDiscuss: () => void;
  onChanged: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function decide(input: DecisionInput) {
    setBusy(true);
    try {
      await api.upsertDecision(eventId, restaurantId, input);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!task) return;
    setBusy(true);
    try {
      await api.claimVerification(eventId, task.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="resto-actions stack">
      {task?.status === "open" ? (
        <p className="muted">Suggested question: “{task.question}”</p>
      ) : null}
      {task?.status === "claimed" && task.assignedToUserId && task.assignedToUserId !== userId ? (
        <p className="muted">{names.get(task.assignedToUserId) ?? "A member"} is verifying this.</p>
      ) : null}
      {currentDecision && currentDecision !== "neutral" ? (
        <p className="muted">Your decision: {currentDecision}</p>
      ) : null}
      <div className="btn-row">
        {task?.status === "open" ? (
          <button className="btn" type="button" disabled={busy} onClick={() => void claim()}>
            I'll verify
          </button>
        ) : null}
        {task?.status === "claimed" && task.assignedToUserId === userId ? (
          <>
            <button className="btn" type="button" disabled={busy} onClick={() => setVerifyOpen(true)}>
              Save result
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => void api.releaseVerification(eventId, task.id).then(onChanged)}
            >
              Release task
            </button>
          </>
        ) : null}
        <button className="btn secondary" type="button" onClick={onDiscuss}>
          Discuss
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy}
          onClick={() => void decide({ decision: "approve" })}
        >
          Approve
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void decide({ decision: "prefer" })}>
          Prefer
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void decide({ decision: "dislike" })}>
          Dislike
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => setRejectOpen(true)}>
          Reject
        </button>
      </div>
      {rejectOpen ? (
        <RejectDialog
          restaurantName={restaurantName}
          busy={busy}
          onCancel={() => setRejectOpen(false)}
          onSubmit={async (input) => {
            await decide(input);
            setRejectOpen(false);
          }}
        />
      ) : null}
      {verifyOpen && task ? (
        <VerifyDialog
          question={task.question}
          phone={phone}
          email={email}
          busy={busy}
          onCancel={() => setVerifyOpen(false)}
          onSubmit={async (input) => {
            setBusy(true);
            try {
              await api.completeVerification(eventId, task.id, input);
              setVerifyOpen(false);
              onChanged();
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function RejectDialog({
  restaurantName,
  busy,
  onCancel,
  onSubmit
}: {
  restaurantName: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: DecisionInput) => Promise<void>;
}) {
  const [reasonCategory, setReasonCategory] = useState("other");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<"event" | "private">("event");
  return (
    <dialog className="modal" open>
      <form
        className="modal-card stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            decision: "reject",
            reasonCategory: reasonCategory as DecisionInput["reasonCategory"],
            note: note.trim() || undefined,
            visibility
          });
        }}
      >
        <h3>Reject {restaurantName}?</h3>
        <label className="field">
          <span>Why? (optional)</span>
          <select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)}>
            {REJECT_REASONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Additional note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field">
          <span>Share reason with</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as "event" | "private")}>
            <option value="event">Everyone</option>
            <option value="private">My agent only</option>
          </select>
        </label>
        <div className="btn-row">
          <button className="btn secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" type="submit" disabled={busy}>
            Reject restaurant
          </button>
        </div>
      </form>
    </dialog>
  );
}

function VerifyDialog({
  question,
  phone,
  email,
  busy,
  onCancel,
  onSubmit
}: {
  question: string;
  phone?: string;
  email?: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: CompleteVerificationInput) => Promise<void>;
}) {
  const [result, setResult] = useState<CompleteVerificationInput["result"]>("supports");
  const [method, setMethod] = useState<CompleteVerificationInput["method"]>("phone");
  const [notes, setNotes] = useState("");
  return (
    <dialog className="modal" open>
      <form
        className="modal-card stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ result, method, notes: notes.trim() || undefined, visibility: "event" });
        }}
      >
        <h3>What did you find out?</h3>
        <p>{question}</p>
        {phone ? (
          <p className="muted">
            Restaurant phone: <a href={phoneHref(phone)}>{phone}</a>
          </p>
        ) : null}
        {email ? (
          <p className="muted">
            Restaurant email: <a href={`mailto:${email}`}>{email}</a>
          </p>
        ) : null}
        <label className="field">
          <span>Result</span>
          <select value={result} onChange={(e) => setResult(e.target.value as CompleteVerificationInput["result"])}>
            <option value="supports">They can accommodate it</option>
            <option value="contradicts">They cannot accommodate it</option>
            <option value="uncertain">Still unclear</option>
          </select>
        </label>
        <label className="field">
          <span>How did you verify it?</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as CompleteVerificationInput["method"])}>
            <option value="phone">Phone</option>
            <option value="in-person">In person</option>
            <option value="email">Email</option>
            <option value="website">Website</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">
          <span>Notes (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="btn-row">
          <button className="btn secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" type="submit" disabled={busy}>
            Save result
          </button>
        </div>
      </form>
    </dialog>
  );
}
