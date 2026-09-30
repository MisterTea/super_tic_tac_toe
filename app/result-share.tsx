"use client";
import { useMutation, api } from "../lib/neon-client";
import { useState } from "react";
import ShareLink from "./share-link";
export default function ResultShare({
  tournament,
  crown,
}: {
  tournament: string;
  crown: boolean;
}) {
  const create = useMutation(api.growth.shareResult);
  const [token, setToken] = useState<string | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function publish() {
    setPending(true);
    setError("");
    try {
      setToken(await create({ tournament }));
    } catch {
      setError("Your result couldn't be shared yet. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="result-sharing">
      {token ? (
        <ShareLink
          url={`${location.origin}/share/${token}`}
          text={
            crown
              ? "I won a crown in Tic Tac Toe Royale. Can you?"
              : "Can you beat my run in Tic Tac Toe Royale?"
          }
          label="Share my run"
          image={`/share/${token}/image`}
        />
      ) : (
        <>
          <button
            className="secondary"
            disabled={pending}
            onClick={() => void publish()}
          >
            {pending ? "Creating card…" : "Share my run →"}
          </button>
          <p className="fine-print">
            Sharing makes your player name and this result public.
          </p>
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
