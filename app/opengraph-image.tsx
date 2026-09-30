import { ImageResponse } from "next/og";
export const alt =
  "Tic Tac Toe Royale. Four rounds. One crown. Play free, no login needed.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#101513",
        color: "#f0f3eb",
        padding: 72,
      }}
    >
      <div style={{ display: "flex", color: "#c4f27b", fontSize: 30 }}>
        TIC TAC TOE ROYALE
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 88,
          fontWeight: 700,
          marginTop: 28,
        }}
      >
        Four rounds.
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 88,
          fontWeight: 700,
          color: "#c4f27b",
        }}
      >
        One crown.
      </div>
      <div style={{ display: "flex", fontSize: 32, marginTop: 36 }}>
        Can you win? Play free. No login needed.
      </div>
    </div>,
    size,
  );
}
