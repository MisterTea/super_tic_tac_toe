"use client";
import { AccountLogin } from "./account-login";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ConvexReactClient,
  ConvexProvider,
  useConvexAuth,
  useMutation,
  useQuery,
  useConnectionStatus,
  ConvexBetterAuthProvider,
  ConvexError,
  api,
} from "../../lib/neon-client";
import { authClient } from "../../lib/auth-client";
import {
  cosmetics,
  DEFAULT_SETTINGS,
  levelFor,
  roundNames,
  tierIndex,
  tiers,
  type PublicTournament,
} from "../../lib/royale";
import { initial, play } from "../../lib/game";
import { GameSounds } from "../../lib/sounds";
import Board from "./board";
import StatHeader from "../stat-header";
import FeedbackButton from "../feedback-button";
import ShareLink from "../share-link";
import ResultShare from "../result-share";
import DailyChallenge from "../daily-challenge";

let convexClient: ConvexReactClient | undefined;
let guestSignIn: Promise<unknown> | undefined;
const getClient = () => (convexClient ||= new ConvexReactClient());
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <>
        <section className="royale-card">
          <h1>Connection interrupted.</h1>
          <p>Your tournament is saved. Reconnect to restore your place.</p>
          <button className="primary" onClick={() => location.reload()}>
            Reconnect
          </button>
        </section>
      </>
    ) : (
      this.props.children
    );
  }
}
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="royale">
      <header>
        <StatHeader />
        <div className="header-tools">
          <FeedbackButton />
          <a className="badge" href="/leaderboard">
            Leaderboard ↗
          </a>
        </div>
      </header>
      {children}
      <footer>
        16 ENTER. ONE TAKES THE CROWN.
        <span>Think ahead. Survive the bracket.</span>
        <nav className="legal-links" aria-label="Legal">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </nav>
      </footer>
    </main>
  );
}
function Leaderboard() {
  const players = useQuery(api.leaderboard.top, {});
  return (
    <section
      className="royale-card leaderboard"
      aria-labelledby="leaderboard-title"
    >
      <div className="eyebrow">THE ROAD TO THE TOP</div>
      <h2 id="leaderboard-title">Top 10 players</h2>
      <p>
        Ranked by Royale points. Ties use crowns, then XP. Signed-in players
        only.
      </p>
      {players === undefined ? (
        <p role="status">Loading leaderboard…</p>
      ) : players.length ? (
        <table>
          <caption className="sr-only">Top 10 Royale players</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">RP</th>
              <th scope="col">Crowns</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.name}>
                <td>{p.rank}</td>
                <th scope="row">
                  {p.name}
                  <small>
                    {p.tier} · Level {p.level}
                  </small>
                </th>
                <td>{p.points.toLocaleString("en-US")}</td>
                <td>{p.crowns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No players yet. Log in to join the leaderboard.</p>
      )}
    </section>
  );
}
export function LeaderboardPage() {
  return (
    <ConvexProvider client={getClient()}>
      <Shell>
        <a className="account-back" href="/">
          ← Back to games
        </a>
        <Leaderboard />
      </Shell>
    </ConvexProvider>
  );
}
function SingleGames() {
  return (
    <section
      className="royale-card single-games"
      aria-labelledby="single-games-heading"
    >
      <div className="eyebrow">ONE MATCH. YOUR WAY.</div>
      <h2 id="single-games-heading">Single game</h2>
      <p>Sharpen your skills or challenge a friend.</p>
      <a className="primary" href="/practice?mode=computer">
        Play the computer
      </a>
      <p className="fine-print">
        Choose your difficulty and play at your own pace.
      </p>
      <a className="secondary" href="/practice?mode=host">
        Host game
      </a>
      <p className="fine-print">Invite a friend with a private game link.</p>
    </section>
  );
}
function GuestLoginPrompt({
  profileId,
  pending,
  onLogin,
}: {
  profileId: string;
  pending: boolean;
  onLogin: () => void;
}) {
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = `royale-login-prompt:${profileId}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      /* Storage is optional. */
    }
    popover.current?.showPopover();
    popover.current?.focus();
    try {
      localStorage.setItem(key, "seen");
    } catch {
      /* A guest can still dismiss the prompt without storage. */
    }
  }, [profileId]);
  return (
    <div
      ref={popover}
      popover="auto"
      className="login-popover"
      role="dialog"
      aria-labelledby="login-prompt-title"
      aria-describedby="login-prompt-description"
      tabIndex={-1}
    >
      <div className="eyebrow">YOUR FIRST ROYALE IS IN THE BOOKS</div>
      <h2 id="login-prompt-title">Keep your progress with you.</h2>
      <p id="login-prompt-description">
        Log in to save your rank, crowns, and collection across devices. Your
        guest progress comes with you.
      </p>
      <button className="primary" disabled={pending} onClick={onLogin}>
        Log in
      </button>
      <button
        className="secondary"
        onClick={() => popover.current?.hidePopover()}
      >
        Keep playing as guest
      </button>
      <p className="fine-print">
        Logging in is optional. You can always keep playing.
      </p>
    </div>
  );
}
export default function Royale({
  account = false,
  daily = false,
}: {
  account?: boolean;
  daily?: boolean;
}) {
  return (
    <Shell>
      <Boundary>
        <ConvexBetterAuthProvider
          client={getClient()}
          authClient={authClient as any}
        >
          <Session account={account} daily={daily} />
        </ConvexBetterAuthProvider>
      </Boundary>
    </Shell>
  );
}
function Session({ account, daily }: { account: boolean; daily: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const session = authClient.useSession();
  const ensure = useMutation(api.royale.ensureProfile);
  const attribute = useMutation(api.growth.attribute);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (session.isPending || session.data) return;
    guestSignIn ||= authClient.signIn
      .anonymous()
      .then(async (result) => {
        if (result.error)
          throw new Error(
            result.error.message || "Could not create guest session",
          );
        await session.refetch();
      })
      .finally(() => {
        guestSignIn = undefined;
      });
    let alive = true;
    void guestSignIn.catch((e) => {
      if (alive) setError(String(e));
    });
    return () => {
      alive = false;
    };
  }, [session.isPending, session.data]);
  useEffect(() => {
    if (!isAuthenticated) {
      setReady(false);
      return;
    }
    let alive = true;
    void ensure({})
      .then(async () => {
        const params = new URLSearchParams(location.search);
        await attribute({
          source: params.get("utm_source") || "direct",
          campaign: params.get("utm_campaign") || "none",
        });
        if (alive) setReady(true);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [isAuthenticated, ensure, attribute]);
  if (!ready)
    return (
      <>
        <section className="royale-card">
          <h1>{error ? "Could not enter the arena." : "Opening the arena…"}</h1>
          <p role="status">{error || "Restoring your player profile."}</p>
          {error ? (
            <button className="primary" onClick={() => location.reload()}>
              Retry connection
            </button>
          ) : null}
        </section>
        <SingleGames />
      </>
    );
  const guest = !!session.data?.user.isAnonymous;
  return account ? (
    <Account guest={guest} />
  ) : daily ? (
    <>
      <a className="secondary" href="/">
        ← Royale
      </a>
      <DailyChallenge />
    </>
  ) : (
    <Arena guest={guest} />
  );
}
function Account({ guest }: { guest: boolean }) {
  const data = useQuery(api.royale.dashboard, {});
  const providers = useQuery(api.auth.providers, {});
  const rename = useMutation(api.royale.rename);
  const equip = useMutation(api.royale.equip);
  const setOptOut = useMutation(api.leaderboard.setOptOut);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (data) setName(data.profile.name);
  }, [data?.profile.name]);
  async function act(work: () => Promise<unknown>) {
    setPending(true);
    setError("");
    setSaved("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : e instanceof Error
            ? e.message
            : "Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  if (!data)
    return (
      <>
        <p role="status">Loading your account…</p>
      </>
    );
  const p = data.profile;
  return (
    <>
      <a className="account-back" href="/">
        ← Back to games
      </a>
      <section className="royale-card account-panel">
        <div className="eyebrow">YOUR PLAYER ACCOUNT</div>
        <h1 className="compact-heading">
          {guest ? "Log in to your account" : "Your account"}
        </h1>
        {guest ? (
          <>
            <p>
              Log in to change your player name and save your rank, crowns, and
              collection across devices. Your guest progress comes with you.
            </p>
            <AccountLogin
              google={!!providers?.google}
              pending={pending}
              active={!!p.active}
              act={act}
            />
            {p.active ? <p>Finish your tournament to log in.</p> : null}
            <p>
              You can always <a href="/">keep playing as a guest</a>.
            </p>
          </>
        ) : (
          <>
            <p>
              {tiers[tierIndex(p.points)]} · {p.points} RP · Level{" "}
              {levelFor(p.xp)} · {p.crowns} crowns
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  const updated = await rename({ name });
                  setName(updated);
                  setSaved("Player name saved.");
                });
              }}
            >
              <label htmlFor="player-name">Player name</label>
              <input
                id="player-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved("");
                }}
                minLength={3}
                maxLength={24}
                required
                disabled={pending || !!p.active}
                autoComplete="off"
                aria-describedby="player-name-help"
              />
              <p id="player-name-help" className="fine-print">
                3–24 characters. Letters, numbers, spaces, hyphens, and
                underscores. Names must be unique.
              </p>
              {p.active ? (
                <p>Finish your tournament before changing your name.</p>
              ) : null}
              <button
                className="primary"
                disabled={pending || !!p.active || name === p.name}
                type="submit"
              >
                {pending ? "Saving…" : "Save player name"}
              </button>
            </form>
            <h2>Leaderboard settings</h2>
            <label className="leaderboard-preference">
              <input
                type="checkbox"
                checked={p.leaderboardOptOut ?? false}
                disabled={pending}
                onChange={(event) => {
                  const optOut = event.target.checked;
                  void act(async () => {
                    await setOptOut({ optOut });
                    setSaved("Leaderboard preference saved.");
                  });
                }}
              />
              Hide me from the leaderboard
            </label>
            <p className="fine-print">
              Signed-in players appear by default. Checking this removes your
              name and scores from the public leaderboard. Your rank and rewards
              stay the same.
            </p>
            <h2>Your collection</h2>
            <div className="cosmetic-grid">
              {cosmetics.map((c) => (
                <button
                  key={c.id}
                  disabled={pending || !p.cosmetics.includes(c.id)}
                  aria-pressed={Object.values(p.equipped).includes(c.id)}
                  onClick={() => void act(() => equip({ id: c.id }))}
                >
                  <strong>{c.name}</strong>
                  <span>
                    {c.kind} · Level {c.level}
                    {p.cosmetics.includes(c.id) ? " · Unlocked" : ""}
                  </span>
                </button>
              ))}
            </div>
            <h2>Recent tournaments</h2>
            {data.history.length ? (
              <ul className="history">
                {data.history.map((r) => (
                  <li key={r._id}>
                    {finishLabel(r.finish)}
                    <span>
                      {r.delta >= 0 ? "+" : ""}
                      {r.delta} RP · +{r.xp} XP
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Your first crown is waiting.</p>
            )}
            <button
              className="secondary"
              disabled={pending || !!p.active}
              onClick={() =>
                void act(async () => {
                  const response = await authClient.signOut();
                  if (response.error) throw new Error(response.error.message);
                  guestSignIn = undefined;
                  location.href = "/";
                })
              }
            >
              Sign out
            </button>
          </>
        )}
        {error ? (
          <p className="royale-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? <p role="status">{saved}</p> : null}
      </section>
    </>
  );
}
function Arena({ guest }: { guest: boolean }) {
  const connectionRetrying = useConnectionStatus();
  const [invitation, setInvitation] = useState<string | null>(null);
  useEffect(() => {
    setInvitation(new URLSearchParams(location.search).get("room"));
  }, []);
  const invitedRoom = useQuery(
    api.growth.room,
    invitation ? { code: invitation } : "skip",
  );
  const host = useMutation(api.growth.host),
    start = useMutation(api.growth.start);
  const data = useQuery(api.royale.dashboard, {});
  const join = useMutation(api.royale.join),
    leave = useMutation(api.royale.leaveLobby),
    move = useMutation(api.royale.move),
    resign = useMutation(api.royale.resign);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [localNow, setNow] = useState(Date.now),
    [selectedMatch, setSelectedMatch] = useState<number | null>(null),
    [watchResults, setWatchResults] = useState(false),
    [soundOn, setSoundOn] = useState(true);
  const sounds = useRef<GameSounds | null>(null),
    previousMove = useRef(""),
    clockOffset = useRef(0),
    previousOutcome = useRef("");
  useEffect(() => {
    if (data) clockOffset.current = data.serverNow - Date.now();
  }, [data?.serverNow]);
  const now = localNow + clockOffset.current;
  useEffect(() => {
    sounds.current = new GameSounds();
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => {
      clearInterval(timer);
      sounds.current?.close();
    };
  }, []);
  const [optimistic, setOptimistic] = useState<{
    tournament: string;
    match: PublicTournament["matches"][number];
  } | null>(null);
  const t = data?.tournament;
  const phase = data?.view?.phase;
  const showResultsWatch =
    phase === "results" && watchResults && t?.status === "active";
  const matchId = showResultsWatch
    ? (selectedMatch ?? t?.matches.find((m) => m.status === "playing")?.id)
    : data?.view?.matchId;
  const confirmedMatch =
    matchId === undefined || matchId === null ? undefined : t?.matches[matchId];
  const showOptimistic =
    !!optimistic &&
    optimistic.tournament === t?.id &&
    optimistic?.match.id === confirmedMatch?.id &&
    !!confirmedMatch &&
    optimistic.match.state.moves.length > confirmedMatch.state.moves.length;
  const match = showOptimistic ? optimistic!.match : confirmedMatch;
  useEffect(() => {
    if (optimistic && !showOptimistic) setOptimistic(null);
  }, [optimistic, showOptimistic]);
  useEffect(() => {
    if (!match) return;
    const key = `${t?.id}:${match.id}:${match.state.moves.length}`;
    if (previousMove.current !== key && match.state.moves.length > 0)
      sounds.current?.play(match.state.moves.length % 2 ? "x" : "o");
    previousMove.current = key;
  }, [t?.id, match?.id, match?.state.moves.length]);
  useEffect(() => {
    if (!t || !data || t.status === "lobby") return;
    const entrant = t.entrants.find((e) => e.id === data.profile._id);
    if (!entrant) return;
    const outcome = `${t.id}:${entrant.wins}:${entrant.finish ?? "active"}`;
    if (previousOutcome.current && previousOutcome.current !== outcome) {
      if (entrant.finish !== undefined && entrant.finish !== 4)
        sounds.current?.play("lose");
      else if (entrant.wins > 0) sounds.current?.play("win");
    }
    previousOutcome.current = outcome;
  }, [t?.id, data?.view?.phase, data?.tournament?.version]);
  async function act(work: () => Promise<unknown>) {
    if (pending) return;
    setPending(true);
    setError("");
    sounds.current?.unlock();
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again");
    } finally {
      setPending(false);
    }
  }
  if (!data)
    return (
      <>
        <p role="status">Loading your arena…</p>
      </>
    );
  const p = data.profile,
    level = levelFor(p.xp),
    tier = tiers[tierIndex(p.points)],
    me = t?.entrants.find((e) => e.id === p._id),
    result = data.history.find((r) => r.tournament === t?.id),
    playing = phase === "playing",
    waiting = phase === "spectating",
    countdown = phase === "countdown",
    finished = phase === "results",
    lobby = phase === "lobby",
    idle = !p.active && !finished;
  const seat = match?.players.indexOf(p._id) ?? -1;
  const canPlay =
    playing && !!match && seat === (match.state.turn === 1 ? 0 : 1) && !pending;
  const theme =
    cosmetics.find((c) => c.id === p.equipped.theme)?.name.toLowerCase() ||
    "default";
  const title =
    cosmetics.find((c) => c.id === p.equipped.title)?.name || "Challenger";
  const effect =
    cosmetics.find((c) => c.id === p.equipped.effect)?.name || "Crown";
  const login = () => location.assign("/account");
  return (
    <>
      <div className="player-strip">
        <a
          className="profile-chip"
          href="/account"
          aria-label={`Account for ${p.name}`}
        >
          {p.name}{" "}
          <span>
            {tier} · {p.points} RP
          </span>
        </a>
        <span>
          Level {level} · {p.crowns} crowns
        </span>
        {guest ? (
          <button
            className="secondary login-button"
            disabled={pending || !!p.active}
            title={
              p.active
                ? "Finish your tournament to log in"
                : "Save your progress across devices"
            }
            onClick={login}
          >
            Log in
          </button>
        ) : null}
        <button
          className="sound-toggle"
          aria-pressed={soundOn}
          onClick={() => {
            setSoundOn(!soundOn);
            sounds.current?.setEnabled(!soundOn);
          }}
        >
          Sound {soundOn ? "on" : "off"}
        </button>
      </div>
      {connectionRetrying ? (
        <p className="royale-error" role="status">
          Connection interrupted. Reconnecting to your saved game…
        </p>
      ) : null}
      {guest && finished && data.history.length === 1 && !p.active ? (
        <GuestLoginPrompt profileId={p._id} pending={pending} onLogin={login} />
      ) : null}
      {error ? (
        <div className="royale-error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}
      {invitation && !p.active ? (
        <section className="royale-card invitation">
          <div className="eyebrow">YOU'RE INVITED</div>
          <h2>A Royale with friends.</h2>
          <p>
            {invitedRoom === undefined
              ? "Checking your lobby…"
              : invitedRoom?.open
                ? `${invitedRoom.count}/16 seats filled · no login needed · unranked`
                : "This lobby has started or closed. Host a new one together."}
          </p>
          {invitedRoom?.open ? (
            <button
              className="primary"
              disabled={pending}
              onClick={() =>
                void act(async () => {
                  setWatchResults(false);
                  setSelectedMatch(null);
                  await join({ roomCode: invitation });
                  setInvitation(null);
                  history.replaceState(null, "", "/");
                })
              }
            >
              Join friend Royale →
            </button>
          ) : null}
          <button
            className="secondary"
            onClick={() => {
              setInvitation(null);
              history.replaceState(null, "", "/");
            }}
          >
            Dismiss invitation
          </button>
        </section>
      ) : null}
      {idle ? (
        <div className="game-choices">
          <section className="intro royale-intro">
            <div className="eyebrow">
              ROYALE · 16 PLAYERS. FOUR ROUNDS. ONE CROWN.
            </div>
            <h1>
              Tic-tac-toe.
              <br />
              <span>Battle royale.</span>
            </h1>
            <p>
              Four rounds. One crown. Can you win? Outplay your rival, scout
              your next opponent, and survive the bracket.
            </p>
            <button
              className="primary royale-cta"
              disabled={pending}
              onClick={() =>
                void act(async () => {
                  setWatchResults(false);
                  setSelectedMatch(null);
                  await join({});
                })
              }
            >
              {pending ? "Joining…" : "Play Royale →"}
            </button>
            <p className="fine-print">
              {tier} matchmaking · Brackets start after 30 seconds · 15 seconds
              per move
            </p>
            <div className="growth-options">
              <button
                className="secondary"
                disabled={pending}
                onClick={() =>
                  void act(async () => {
                    await host({});
                    setWatchResults(false);
                    setSelectedMatch(null);
                  })
                }
              >
                Host a friend Royale →
              </button>
              <a className="secondary" href="/daily">
                Today's daily challenge →
              </a>
            </div>
            <p className="fine-print">
              Free in your browser. No download or login needed.
            </p>
          </section>
          <SingleGames />
        </div>
      ) : null}
      {lobby && t ? (
        <div className="royale-workspace">
          <section className="royale-card">
            <div className="eyebrow">WARM UP WHILE WE FILL THE FIELD</div>
            <h1 className="compact-heading">Your bracket is forming.</h1>
            <div className="lobby-count">
              <strong>
                {t.entrants.length}
                <small>/16</small>
              </strong>
              <span>
                Starts in {Math.max(0, Math.ceil((t.closesAt - now) / 1000))}s
              </span>
            </div>
            <progress
              aria-label="Lobby entrants"
              max={16}
              value={t.entrants.length}
            />
            <div className="entrant-grid">
              {Array.from({ length: 16 }, (_, i) => (
                <div
                  key={i}
                  className={t.entrants[i] ? "entrant filled" : "entrant"}
                >
                  <span>{t.entrants[i]?.avatar || "○"}</span>
                  {t.entrants[i]?.name || "Open seat"}
                </div>
              ))}
            </div>
            <p>Your bracket starts when the countdown ends.</p>
            {data.roomCode ? (
              <div className="friend-invite">
                <p>
                  Friend Royale · unranked. Invite your friends before the
                  bracket starts.
                </p>
                <ShareLink
                  url={`${location.origin}/?room=${data.roomCode}&utm_source=invite&utm_campaign=${data.roomCode}`}
                  text="Join my Tic Tac Toe Royale. Four rounds. One crown."
                  label="Invite friends"
                />
                {data.isHost ? (
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={() => void act(() => start({}))}
                  >
                    Start Royale now →
                  </button>
                ) : (
                  <p>The host can start when everyone is ready.</p>
                )}
              </div>
            ) : null}
            <button
              className="secondary"
              disabled={pending}
              onClick={() => void act(() => leave({}))}
            >
              Leave lobby
            </button>
          </section>
          <Warmup />
        </div>
      ) : null}
      {finished && t && !showResultsWatch ? (
        <div className="game-choices">
          <section
            className={`royale-card result-card ${me?.finish === 4 ? "champion" : ""}`}
            data-effect={effect}
          >
            <div className="eyebrow">
              {me?.finish === 4 ? "♛ VICTORY ROYALE" : "YOUR RUN"}
            </div>
            <h1 className="compact-heading">{finishLabel(me?.finish ?? 0)}</h1>
            <p>
              {me?.finish === 4
                ? `The crown is yours, ${p.name}.`
                : "A new bracket. A fresh chance."}
            </p>
            <div className="reward-row">
              <strong>
                {(result?.delta || 0) >= 0 ? "+" : ""}
                {result?.delta || 0}
                <small>Rank points</small>
              </strong>
              <strong>
                +{result?.xp || 0}
                <small>XP earned</small>
              </strong>
              <strong>
                {me?.wins || 0}
                <small>Matches won</small>
              </strong>
            </div>
            <p>
              {tier} · {p.points} RP · Level {level} ·{" "}
              {cosmetics.find((c) => c.level > level)?.name
                ? `Next unlock: ${cosmetics.find((c) => c.level > level)!.name}`
                : "Collection complete"}
            </p>
            <button
              className="primary royale-cta"
              disabled={pending}
              onClick={() =>
                void act(async () => {
                  setSelectedMatch(null);
                  setWatchResults(false);
                  await join({});
                })
              }
            >
              Play again →
            </button>
            {result && t.id ? (
              <ResultShare
                key={t.id}
                tournament={t.id}
                crown={!!result.crown}
              />
            ) : null}
            <div className="growth-options">
              <button
                className="secondary"
                disabled={pending}
                onClick={() =>
                  void act(async () => {
                    await host({});
                    setWatchResults(false);
                    setSelectedMatch(null);
                  })
                }
              >
                Host a friend Royale →
              </button>
              <a className="secondary" href="/daily">
                Today's daily challenge →
              </a>
            </div>
            {t.status === "active" ? (
              <button
                className="secondary"
                onClick={() => {
                  setSelectedMatch(null);
                  setWatchResults(true);
                }}
              >
                Watch the rest of the bracket
              </button>
            ) : null}
          </section>
          <SingleGames />
        </div>
      ) : null}
      {(playing || waiting || countdown || (finished && showResultsWatch)) &&
      t ? (
        <div className="royale-workspace">
          <section className={`arena theme-${theme}`}>
            <div className="eyebrow">
              {waiting
                ? "YOU ADVANCED · SCOUT YOUR NEXT OPPONENT"
                : countdown
                  ? "NEXT MATCH CONFIRMED"
                  : finished
                    ? "LIVE SPECTATOR"
                    : match
                      ? roundNames[match.round].toUpperCase()
                      : "YOUR BRACKET"}
            </div>
            <h2>
              {waiting
                ? `Watching your ${roundNames[data.view?.nextRound ?? 1].toLowerCase()} opponent`
                : countdown
                  ? `Your next match starts in ${Math.max(0, Math.ceil(((match?.startAt || now) - now) / 1000))}s`
                  : playing
                    ? canPlay
                      ? "Your turn."
                      : "Opponent’s turn."
                    : "Follow the crown."}
            </h2>
            {match ? (
              <>
                <div className="score">
                  {match.players.map((id, i) => {
                    const e = t.entrants.find((entry) => entry.id === id);
                    const remaining =
                      match.clocks[i] -
                      (match.status === "playing" &&
                      i === (match.state.turn === 1 ? 0 : 1)
                        ? Math.max(0, now - match.turnAt)
                        : 0);
                    return (
                      <span
                        key={id}
                        className={
                          i === (match.state.turn === 1 ? 0 : 1) ? "active" : ""
                        }
                      >
                        {i === 0 ? "✕" : "◯"} {e?.name}
                        <b>{Math.max(0, Math.ceil(remaining / 1000))}s</b>
                      </span>
                    );
                  })}
                </div>
                <Board
                  state={match.state}
                  enabled={canPlay}
                  onMove={(action) =>
                    void act(async () => {
                      const next = play(match.state, action);
                      const clocks = [...match.clocks] as [number, number];
                      clocks[next.turn === 1 ? 0 : 1] = (
                        t.settings || DEFAULT_SETTINGS
                      ).clockMs;
                      setOptimistic({
                        tournament: t.id!,
                        match: { ...match, state: next, clocks, turnAt: now },
                      });
                      try {
                        const accepted = await move({
                          tournament: t.id!,
                          match: match.id,
                          seq: match.state.moves.length,
                          action,
                        });
                        clockOffset.current = accepted.serverNow - Date.now();
                        setOptimistic({
                          tournament: t.id!,
                          match: accepted.match,
                        });
                      } catch (e) {
                        setOptimistic(null);
                        throw e;
                      }
                    })
                  }
                />
                <p className="hint">
                  {waiting || finished
                    ? "Watching live · your next match begins automatically when both players are ready."
                    : countdown
                      ? "Get ready. Your thinking clock starts with the match."
                      : match.state.forced === -1
                        ? "Free choice · play in any highlighted board."
                        : `Next move · board ${match.state.forced + 1} is highlighted.`}
                </p>
                {match.tieReveal ? (
                  <details>
                    <summary>Tiebreak proof</summary>
                    <p className="proof">
                      Commitment: {match.commitment}
                      <br />
                      Revealed seed: {match.tieReveal}
                    </p>
                  </details>
                ) : null}
              </>
            ) : (
              <p>Waiting for the bracket to update…</p>
            )}
            {playing || countdown || waiting ? (
              <button
                className="secondary"
                disabled={pending}
                onClick={() => void act(() => resign({ tournament: t.id! }))}
              >
                {waiting ? "Withdraw from tournament" : "Resign match"}
              </button>
            ) : null}
            {finished ? (
              <button
                className="secondary"
                onClick={() => setWatchResults(false)}
              >
                Back to results
              </button>
            ) : null}
          </section>
          <Bracket
            t={t}
            player={p._id}
            onSelect={finished ? (id) => setSelectedMatch(id) : undefined}
          />
        </div>
      ) : null}
      {finished && t && !showResultsWatch ? (
        <Bracket t={t} player={p._id} />
      ) : null}
      <DailyQuests quest={data.quests} />
      {idle || finished ? <Leaderboard /> : null}
      <details className="royale-rules">
        <summary>How Royale works</summary>
        <p>
          Win three small boards in a row to win a match. Every square sends
          your opponent to its corresponding board. Win four matches to take the
          crown.
        </p>
        <p>
          Each move starts a fresh 15-second thinking clock. Running out loses
          the match. Tied small boards become wildcards for either player. If
          both players complete a line, the player who made the wildcard wins.
          Finished boards and the three-minute match limit use most claimed
          boards, then the player who went first.
        </p>
        <p>
          Placement gives the same rank credit regardless of opponent. Bronze
          cannot lose points. Cosmetics never change your strength.
        </p>
      </details>
    </>
  );
}
function finishLabel(finish: number) {
  return ["Top 16", "Top 8", "Top 4", "Runner-up", "Champion"][finish];
}
function Bracket({
  t,
  player,
  onSelect,
}: {
  t: PublicTournament;
  player: string;
  onSelect?: (id: number) => void;
}) {
  return (
    <section className="royale-card bracket">
      <h2>The road to the crown</h2>
      <div className="bracket-rounds">
        {roundNames.map((name, round) => (
          <div key={name}>
            <h3>{name}</h3>
            {t.matches
              .filter((m) => m.round === round)
              .map((m) => (
                <button
                  key={m.id}
                  className={`bracket-match ${m.players.includes(player) ? "your-match" : ""}`}
                  disabled={!onSelect || m.status === "pending"}
                  onClick={() => onSelect?.(m.id)}
                  aria-label={`Watch ${name} match ${m.id + 1}`}
                >
                  <small>
                    {m.status === "playing"
                      ? "● LIVE"
                      : m.status === "countdown"
                        ? "UP NEXT"
                        : m.status === "finished"
                          ? m.reason?.toUpperCase()
                          : "WAITING"}
                  </small>
                  {m.players.length ? (
                    m.players.map((id) => {
                      const e = t.entrants.find((e) => e.id === id);
                      return (
                        <span
                          key={id}
                          className={m.winner === id ? "bracket-winner" : ""}
                        >
                          {e?.name}
                          {m.winner === id ? " ✓" : ""}
                        </span>
                      );
                    })
                  ) : (
                    <>
                      <span>Feeder winner</span>
                      <span>Feeder winner</span>
                    </>
                  )}
                </button>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}
function DailyQuests({
  quest,
}: {
  quest: {
    completed: number;
    boards: number;
    wins: number;
    claimed: string[];
  } | null;
}) {
  const quests = [
    {
      key: "completed",
      name: "Complete 2 tournaments",
      value: quest?.completed || 0,
      goal: 2,
    },
    {
      key: "boards",
      name: "Claim 5 small boards",
      value: quest?.boards || 0,
      goal: 5,
    },
    { key: "wins", name: "Win a match", value: quest?.wins || 0, goal: 1 },
  ];
  return (
    <section className="daily-quests">
      <div>
        <h2>A little further every day.</h2>
        <p>Daily goals · reset at 00:00 UTC · +75 XP each</p>
      </div>
      <div className="quest-grid">
        {quests.map((q) => (
          <div key={q.key} className="royale-card">
            <strong>
              {quest?.claimed.includes(q.key) ? "✓ " : ""}
              {q.name}
            </strong>
            <progress
              aria-label={q.name}
              max={q.goal}
              value={Math.min(q.value, q.goal)}
            />
            <span>
              {Math.min(q.value, q.goal)}/{q.goal} ·{" "}
              {quest?.claimed.includes(q.key) ? "Reward earned" : "+75 XP"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
function Warmup() {
  const [state, setState] = useState(initial),
    [tab, setTab] = useState("puzzle"),
    [answer, setAnswer] = useState(""),
    [puzzleIndex, setPuzzleIndex] = useState(0);
  const puzzles = [
    { cells: [1, 1, 0, -1, -1, 0, 0, 0, 0], move: 2 },
    { cells: [-1, 0, 1, -1, 0, 1, 0, 0, 0], move: 8 },
    { cells: [1, -1, 0, 0, 1, -1, 0, 0, 0], move: 8 },
  ];
  const puzzle = puzzles[puzzleIndex];
  return (
    <section className="royale-card warmup">
      <div className="eyebrow">KEEP YOUR EDGE</div>
      <h2>Warm-up zone</h2>
      <div className="warmup-tabs">
        <button
          className={tab === "puzzle" ? "selected" : ""}
          onClick={() => setTab("puzzle")}
        >
          Quick puzzle
        </button>
        <button
          className={tab === "practice" ? "selected" : ""}
          onClick={() => setTab("practice")}
        >
          Practice board
        </button>
      </div>
      {tab === "puzzle" ? (
        <>
          <p>You are X. Find the winning move.</p>
          <div className="puzzle-board">
            {puzzle.cells.map((v, i) => (
              <button
                key={i}
                disabled={!!v}
                aria-label={`Puzzle square ${i + 1}`}
                onClick={() =>
                  setAnswer(
                    i === puzzle.move
                      ? "Correct! You found the winning line."
                      : "Look for two X marks in a row.",
                  )
                }
              >
                {v === 1 ? "✕" : v === -1 ? "◯" : ""}
              </button>
            ))}
          </div>
          <p role="status">{answer || "One move can change everything."}</p>
          <button
            className="secondary"
            onClick={() => {
              setPuzzleIndex((index) => (index + 1) % puzzles.length);
              setAnswer("");
            }}
          >
            Next puzzle
          </button>
        </>
      ) : (
        <>
          <p>Explore both sides. Warm-up never changes your rank.</p>
          <Board
            state={state}
            enabled={!state.winner}
            onMove={(a) => setState((previous) => play(previous, a))}
            label="Warm-up board"
          />
          <button className="secondary" onClick={() => setState(initial())}>
            Reset warm-up
          </button>
        </>
      )}
    </section>
  );
}
