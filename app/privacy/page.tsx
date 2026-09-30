import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Super Tic Tac Toe Royale",
};

export default function PolicyPage() {
  return (
    <main className="royale legal-page">
      <a className="account-back" href="/">
        ← Back to games
      </a>
      <article className="royale-card">
        <div className="eyebrow">SUPER TIC TAC TOE ROYALE</div>
        <h1>Privacy Policy</h1>
        <p className="fine-print">Effective September 30, 2026</p>
        <section>
          <h2>Who operates this game</h2>
          <p>
            {
              "Super Tic Tac Toe Royale at boxed.games is operated by Jason Gauci. This policy explains how we handle information when you play, create an account, or contact us. For privacy questions or requests, email jgmath2000@gmail.com."
            }
          </p>
        </section>
        <section>
          <h2>Information we collect</h2>
          <p>
            {
              "Guest play creates a browser session and a player profile. We store player identifiers, names, game moves and results, tournament participation, rank, experience points, crowns, cosmetics, daily challenges, and account preferences. If you register with a password, we store your email, username, and a password hash, not your plaintext password. Login records can include IP addresses, browser information, session tokens, and timestamps."
            }
          </p>
        </section>
        <section>
          <h2>Google sign-in</h2>
          <p>
            {
              "If you choose Google sign-in, we receive your Google account identifier, email address, name, profile picture when available, and email verification status. We may store OAuth tokens needed to support authentication. We use this information to identify you, maintain your session, and connect your saved game progress to your account. We request only basic identity permissions: openid, email, and profile. We do not request access to Gmail messages, Drive files, or contacts, and we never receive your Google password."
            }
          </p>
        </section>
        <section>
          <h2>How we use information</h2>
          <p>
            {
              "We use information to run matches, save and restore progress, link guest profiles to accounts, display rankings, prevent abuse, investigate errors, respond to feedback, and improve the game. Gameplay telemetry records visits, match participation, outcomes, rewards, timing, and referral or campaign information when present. Public statistics show aggregate counts of players, games, and crowns."
            }
          </p>
        </section>
        <section>
          <h2>Public information and multiplayer</h2>
          <p>
            {
              "Player names, rankings, levels, crowns, and game results may be visible to other players. Signed-in players can opt out of the public leaderboard in account settings. Shared result links expose the result associated with that link. Private-game links can be used by anyone who receives them. Private peer-to-peer games use network relays and connection services; those services and connected peers may receive network information, including your IP address, and connection or game messages. Avoid putting personal information in player names or shared links."
            }
          </p>
        </section>
        <section>
          <h2>Cookies and browser storage</h2>
          <p>
            {
              "We use cookies to maintain guest and signed-in sessions. Browser storage remembers settings such as sound, whether a login prompt was shown, and a feedback identifier used to limit duplicate or excessive submissions. Clearing cookies or browser data may prevent you from accessing an unlinked guest profile. You can control storage through your browser settings."
            }
          </p>
        </section>
        <section>
          <h2>Feedback</h2>
          <p>
            {
              "When you submit feedback, we store your message, category, page, submission time, browser-generated identifiers, and any email address you choose to provide. Please do not include passwords or other sensitive information."
            }
          </p>
        </section>
        <section>
          <h2>Service providers and sharing</h2>
          <p>
            {
              "Vercel hosts the application, Neon provides database storage, and Google provides optional sign-in and connection services. Network relay or TURN providers may process information when you use private multiplayer. These providers process information needed to deliver their services and may maintain their own operational logs. We do not sell personal information or use Google account information for targeted advertising. We may disclose information when necessary to comply with law, protect the service and its users, or respond to a valid legal request."
            }
          </p>
        </section>
        <section>
          <h2>Storage, retention, and security</h2>
          <p>
            {
              "Information is processed on our service providers’ infrastructure, which may be in countries other than your own. We use access controls, protected server credentials, encrypted web connections, and password hashing. No service can guarantee absolute security. We retain account and game information to maintain progress and operate the game, and may retain records needed for security, disputes, or legal obligations. We do not currently apply a fixed automatic deletion schedule; backup copies may remain until normal backup expiration."
            }
          </p>
        </section>
        <section>
          <h2>Your choices and requests</h2>
          <p>
            {
              "You can play without Google sign-in, change your player name, opt out of the leaderboard, and sign out. To request access, correction, export, or deletion of your account and associated personal information, email jgmath2000@gmail.com. We may ask for information needed to verify account ownership. Rights and exceptions depend on applicable law. Removing Google access in your Google account does not automatically delete your game account; contact us to request deletion."
            }
          </p>
        </section>
        <section>
          <h2>Children</h2>
          <p>
            {
              "The service is intended for people aged 13 and older. Please do not create an account or submit personal information if you are under 13. If you believe a child under 13 has provided personal information, contact us so we can investigate and remove it as appropriate."
            }
          </p>
        </section>
        <section>
          <h2>Changes to this policy</h2>
          <p>
            {
              "We may update this policy as the game changes. We will update the date on this page and provide additional notice or request consent when required for material changes. Contact jgmath2000@gmail.com with questions."
            }
          </p>
        </section>
        <nav className="legal-links" aria-label="Legal">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="mailto:jgmath2000@gmail.com">Contact</a>
        </nav>
      </article>
    </main>
  );
}
