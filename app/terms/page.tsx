import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Super Tic Tac Toe Royale",
};

export default function PolicyPage() {
  return (
    <main className="royale legal-page">
      <a className="account-back" href="/">
        ← Back to games
      </a>
      <article className="royale-card">
        <div className="eyebrow">SUPER TIC TAC TOE ROYALE</div>
        <h1>Terms of Service</h1>
        <p className="fine-print">Effective September 30, 2026</p>
        <section>
          <h2>Using the service</h2>
          <p>
            {
              "These Terms of Service apply to Super Tic Tac Toe Royale at boxed.games, operated by Jason Gauci. By using the service, you agree to these terms. If you do not agree, do not use the service. You must be at least 13 years old and, if you have not reached the legal age to enter a contract where you live, have permission from a parent or guardian."
            }
          </p>
        </section>
        <section>
          <h2>Accounts and guest progress</h2>
          <p>
            {
              "You may play as a guest or create an account using supported sign-in methods. Keep your password and account access secure, provide accurate account information, and do not impersonate other people. You are responsible for activity through your account except where applicable law provides otherwise. Guest progress is tied to browser access and may become inaccessible if cookies are cleared or sessions expire. Account linking is designed to preserve progress, but recovery of every guest profile is not guaranteed."
            }
          </p>
        </section>
        <section>
          <h2>Fair play and acceptable use</h2>
          <p>
            {
              "Do not cheat, exploit bugs, manipulate rankings, automate competitive play to gain an unfair advantage, interfere with other players or infrastructure, bypass access controls, or access accounts without permission. Do not use offensive or misleading player names, harass others, or submit unlawful content. Good-faith security research should avoid accessing other people’s information or disrupting the service; report issues to jgmath2000@gmail.com."
            }
          </p>
        </section>
        <section>
          <h2>Ranks, rewards, and availability</h2>
          <p>
            {
              "Matches may include computer-controlled opponents. Rankings, experience, crowns, cosmetics, and other game rewards are virtual game features with no cash value, ownership interest, or guaranteed monetary prize. We may adjust game rules, correct results, reset rankings, or change rewards to maintain the game. Network problems, maintenance, bugs, and account restrictions can interrupt play or affect results. We do not guarantee continuous availability or permanent preservation of progress."
            }
          </p>
        </section>
        <section>
          <h2>Content and permissions</h2>
          <p>
            {
              "The game software, branding, and original content are protected by applicable intellectual-property laws and any licenses that apply to individual components. You may use the service for its intended gameplay purposes. You retain rights to feedback and other content you submit, and give us permission to store, display, and use that content as needed to operate, moderate, and improve the service. Do not submit content you have no right to use. Public player names and shared results can be displayed as part of gameplay."
            }
          </p>
        </section>
        <section>
          <h2>Privacy and third-party services</h2>
          <p>
            {
              "Our Privacy Policy describes how we handle personal information. Google sign-in, hosting providers, and multiplayer network services may have their own terms and privacy policies. We do not control third-party availability or policies. Using Google sign-in is optional."
            }
          </p>
        </section>
        <section>
          <h2>Restrictions and termination</h2>
          <p>
            {
              "We may limit or suspend access when reasonably necessary to address cheating, abuse, security threats, legal requirements, or violations of these terms. You may stop using the service at any time. To request account deletion or appeal an account restriction, contact jgmath2000@gmail.com."
            }
          </p>
        </section>
        <section>
          <h2>Disclaimers and liability</h2>
          <p>
            {
              "To the extent permitted by applicable law, the service is provided as available, without warranties that it will be uninterrupted, error-free, or suitable for a particular purpose. To that same extent, we are not liable for indirect or consequential losses arising from use of the service, including lost game progress. These terms do not exclude rights or liabilities that cannot legally be excluded, including applicable consumer rights."
            }
          </p>
        </section>
        <section>
          <h2>Changes and contact</h2>
          <p>
            {
              "We may update these terms or the service. Material changes will be reflected in the date on this page and communicated when required. Changes do not remove rights that applicable law protects. Questions, complaints, and support requests can be sent to jgmath2000@gmail.com."
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
