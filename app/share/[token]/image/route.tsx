import { ImageResponse } from "next/og";
import { loadSharedResult, resultTitle } from "../../../../lib/shared-result";
import { roundNames } from "../../../../lib/royale";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params,
    r = await loadSharedResult(token);
  if (!r) return new Response("Result not found", { status: 404 });
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        background: "#101513",
        color: "#f0f3eb",
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", color: "#c4f27b", fontSize: 26 }}>
        TIC TAC TOE ROYALE · FOUR ROUNDS. ONE CROWN.
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 76,
          fontWeight: 700,
          marginTop: 24,
        }}
      >
        {resultTitle(r)}
      </div>
      <div style={{ display: "flex", fontSize: 34, marginTop: 8 }}>
        {r.name} · {r.wins} matches won
      </div>
      <div style={{ display: "flex", marginTop: 40, gap: 16 }}>
        {roundNames.map((name, i) => {
          const round = r.rounds.find((o) => o.round === i);
          return (
            <div
              key={name}
              style={{
                display: "flex",
                flexDirection: "column",
                width: 240,
                padding: 18,
                border: "1px solid #45523e",
                borderRadius: 12,
              }}
            >
              <span style={{ fontSize: 20, color: "#95a398" }}>{name}</span>
              <span
                style={{
                  fontSize: 34,
                  marginTop: 8,
                  color: round?.won ? "#c4f27b" : "#f0f3eb",
                }}
              >
                {round ? (round.won ? "WIN" : "OUT") : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", marginTop: 40, fontSize: 28 }}>
        Can you beat this run? Play free. No login needed.
      </div>
      <div
        style={{
          display: "flex",
          color: "#95a398",
          fontSize: 20,
          marginTop: 12,
        }}
      >
        super-tic-tac-toe-royale.vercel.app
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400" },
    },
  );
}
