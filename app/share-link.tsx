"use client";
import { useState } from "react";
export default function ShareLink({
  url,
  text,
  label = "Challenge a friend",
  image,
}: {
  url: string;
  text: string;
  label?: string;
  image?: string;
}) {
  const [status, setStatus] = useState("");
  async function share() {
    setStatus("");
    try {
      if (navigator.share)
        await navigator.share({ title: "Tic Tac Toe Royale", text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setStatus("Challenge copied!");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus("Copy the link below to share your challenge.");
    }
  }
  return (
    <div className="share-actions">
      <button className="secondary" onClick={() => void share()}>
        {label}
      </button>
      {image ? (
        <a className="secondary" href={image} download="tic-tac-toe-royale.png">
          Save result image
        </a>
      ) : null}
      <input
        aria-label="Challenge link"
        readOnly
        value={url}
        onFocus={(event) => event.target.select()}
      />
      <p role="status">{status}</p>
    </div>
  );
}
