import "./globals.css";
export const metadata = {
  metadataBase: new URL("https://boxed.games"),
  title: "Super Tic Tac Toe Royale",
  description:
    "Sixteen players. Four rounds. One crown. Ultimate tic-tac-toe tournaments.",
  referrer: "no-referrer",
  openGraph: {
    title: "Super Tic Tac Toe Royale",
    description:
      "Four rounds. One crown. Can you win? Play free in your browser, no login needed.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
