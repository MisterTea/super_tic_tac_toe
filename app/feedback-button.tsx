"use client";
import { useRef, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
let client: ConvexHttpClient | undefined;
export default function FeedbackButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<"Bug" | "Idea" | "Other">("Other");
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!url || pending) return;
    setPending(true);
    setError("");
    try {
      let browser: string = crypto.randomUUID();
      try {
        const stored = localStorage.getItem("royale-feedback-client");
        if (stored) browser = stored;
        else localStorage.setItem("royale-feedback-client", browser);
      } catch {
        /* Feedback also works without storage. */
      }
      request.current ||= crypto.randomUUID();
      client ||= new ConvexHttpClient(url);
      await client.mutation(api.feedback.send, {
        message,
        email,
        category,
        website,
        page: location.pathname,
        client: browser,
        request: request.current,
      });
      setSent(true);
      setMessage("");
      setEmail("");
      request.current = null;
    } catch (e) {
      setError(
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : "Feedback could not be sent. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button
        className="feedback-trigger"
        onClick={() => {
          setSent(false);
          setError("");
          dialog.current?.showModal();
        }}
      >
        Leave feedback
      </button>
      <dialog
        ref={dialog}
        className="feedback-dialog"
        aria-labelledby="feedback-title"
      >
        <button
          className="feedback-close"
          aria-label="Close feedback"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
        <div className="eyebrow">HELP SHAPE THE NEXT ROUND</div>
        <h2 id="feedback-title">Leave feedback</h2>
        {sent ? (
          <div role="status">
            <p>Thanks! Your feedback has been saved.</p>
            <button className="primary" onClick={() => dialog.current?.close()}>
              Back to the game
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void send(event)}>
            <p>Found a bug or have an idea? Tell us. No login needed.</p>
            <label htmlFor="feedback-category">Type</label>
            <select
              id="feedback-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as typeof category);
                request.current = null;
              }}
              disabled={pending}
            >
              <option>Bug</option>
              <option>Idea</option>
              <option>Other</option>
            </select>
            <label htmlFor="feedback-message">Your feedback</label>
            <textarea
              id="feedback-message"
              required
              minLength={10}
              maxLength={3000}
              rows={5}
              value={message}
              disabled={pending}
              onChange={(event) => {
                setMessage(event.target.value);
                request.current = null;
              }}
            />
            <label htmlFor="feedback-email">Email (optional)</label>
            <input
              id="feedback-email"
              type="email"
              maxLength={254}
              autoComplete="email"
              value={email}
              disabled={pending}
              onChange={(event) => {
                setEmail(event.target.value);
                request.current = null;
              }}
            />
            <div className="feedback-honeypot" aria-hidden="true">
              <label htmlFor="feedback-website">Website</label>
              <input
                id="feedback-website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>
            <p className="fine-print">
              Feedback is private. Include an email only if you want us to be
              able to reply.
            </p>
            {error ? <p role="alert">{error}</p> : null}
            <button
              className="primary"
              type="submit"
              disabled={pending || !url}
            >
              {pending ? "Sending…" : "Send feedback"}
            </button>
            {!url ? <p>Feedback is being connected.</p> : null}
          </form>
        )}
      </dialog>
    </>
  );
}
