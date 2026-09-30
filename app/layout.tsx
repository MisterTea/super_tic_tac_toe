import "./globals.css";
export const metadata = {
  title: "Ultimate Relay",
  description: "Ultimate tic-tac-toe over Nostr and WebRTC",
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
