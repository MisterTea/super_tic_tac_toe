import { notFound } from "next/navigation";
import { loadSharedResult, resultTitle } from "../../../lib/shared-result";
import { roundNames } from "../../../lib/royale";
import type { Metadata } from "next";
type Props = { params: Promise<{ token: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params,
    r = await loadSharedResult(token);
  if (!r) return { title: "Result not found" };
  const title = `${r.name}: ${resultTitle(r)} · Tic Tac Toe Royale`;
  const description =
    "Four rounds. One crown. Can you beat this run? Free in your browser, no login needed.";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: `/share/${token}/image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/share/${token}/image`],
    },
  };
}
export default async function SharedRun({ params }: Props) {
  const { token } = await params,
    r = await loadSharedResult(token);
  if (!r) notFound();
  return (
    <main className="royale">
      <header>
        <a className="brand" href="/">
          TIC TAC TOE ROYALE
        </a>
        <a className="badge" href="/leaderboard">
          Leaderboard ↗
        </a>
      </header>
      <section
        className={`royale-card shared-run ${r.crown ? "champion" : ""}`}
      >
        <div className="eyebrow">
          {r.crown ? "THE CROWN IS CLAIMED" : "A CHALLENGE FOR YOU"}
        </div>
        <h1>{resultTitle(r)}</h1>
        <h2>{r.name}</h2>
        <p>
          {r.wins} matches won · {r.delta >= 0 ? "+" : ""}
          {r.delta} rank points
        </p>
        <div className="shared-bracket">
          {roundNames.map((round, index) => {
            const outcome = r.rounds.find((o) => o.round === index);
            return (
              <div key={round}>
                <small>{round}</small>
                <strong>{outcome ? (outcome.won ? "WIN" : "OUT") : "—"}</strong>
              </div>
            );
          })}
        </div>
        <h2>Can you beat this run?</h2>
        <a
          className="primary"
          href={`/?utm_source=result&utm_campaign=${token}`}
        >
          Play Royale →
        </a>
        <p>Free in your browser. No download or login needed.</p>
        <a
          className="secondary"
          href={`/share/${token}/image`}
          download="tic-tac-toe-royale.png"
        >
          Save result image
        </a>
      </section>
    </main>
  );
}
