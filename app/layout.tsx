import "./globals.css";
export const metadata = {
  title: "Tic Tac Toe Royale",
  description:
    "Sixteen players. Four rounds. One crown. Ultimate tic-tac-toe tournaments.",
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
