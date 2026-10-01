"use client";
import { useEffect, useRef, useState } from "react";
import { initial, legal, winningLine, play } from "../../lib/game";
import { Network, SessionInfo } from "../../lib/network";
import { remainingSeconds, MOVE_ROUTING_MS } from "../../lib/timing";
import type { BrowserAI } from "../../lib/browser-ai";
import { GameSounds } from "../../lib/sounds";
import StatHeader from "../stat-header";
import FeedbackButton from "../feedback-button";
import BoardEffects from "../royale/board-effects";
type Mode = "choose" | "ai" | "online";
const emptyInfo: SessionInfo = {
  winner: 0,
  role: "spectator",
  connected: false,
  deadline: 0,
  ended: "",
  spectators: 0,
};
export default function Home() {
  const [s, setS] = useState(initial),
    [mode, setMode] = useState<Mode>("choose"),
    [status, setStatus] = useState("Choose your next game"),
    [difficulty, setDifficulty] = useState(5),
    [loading, setLoading] = useState(false),
    [ai, setAI] = useState<BrowserAI | null>(null),
    [info, setInfo] = useState(emptyInfo),
    [invite, setInvite] = useState(""),
    [relays, setRelays] = useState("wss://relay.damus.io,wss://nos.lol"),
    [now, setNow] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [preview, setPreview] = useState<number | null>(null);
  const sounds = useRef<GameSounds | null>(null);
  const soundState = useRef({ moves: [] as number[], winner: 0 });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0, gap: 10 });
  useEffect(() => {
    const audio = new GameSounds();
    sounds.current = audio;
    try {
      const enabled = localStorage.getItem("ultimate-relay-sound") !== "off";
      audio.setEnabled(enabled);
      setSoundOn(enabled);
    } catch {
      /* Storage is optional. */
    }
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      audio.close();
      sounds.current = null;
    };
  }, []);
  const network = useRef<Network | null>(null),
    generation = useRef(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    const leave = () => {
      generation.current++;
      network.current?.close();
    };
    window.addEventListener("pagehide", leave);
    const params = new URLSearchParams(window.location.search),
      code = params.get("code");
    const configured = params.get("relays") || relays;
    if (params.has("relays")) setRelays(configured);
    // Defer invite joining past React's development lifecycle probe.
    const join = setTimeout(() => {
      if (code) void joinInvite(code, configured);
      else if (params.get("mode") === "computer") void computer();
      else if (params.get("mode") === "host") void hostGame(configured);
    }, 100);
    return () => {
      leave();
      clearTimeout(join);
      clearInterval(id);
      window.removeEventListener("pagehide", leave);
    };
    // Only initialize the invite from the URL on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function clear(next: Mode) {
    soundState.current = { moves: [], winner: 0 };
    generation.current++;
    network.current?.close();
    network.current = null;
    setS(initial());
    setMode(next);
    setInfo(emptyInfo);
    setInvite("");
    setLoading(false);
    setStatus("Ready to play");
    return generation.current;
  }
  function choose() {
    if (
      mode === "online" &&
      info.connected &&
      info.role !== "spectator" &&
      !info.winner &&
      !s.winner
    )
      sounds.current?.play("lose");
    clear("choose");
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
    setStatus("Choose your next game");
  }
  function connect(started: number, configured = relays) {
    const urls = configured
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!urls.length || urls.some((x) => !/^wss?:\/\//.test(x)))
      throw new Error("Enter valid WebSocket relay URLs");
    const ice = process.env.NEXT_PUBLIC_ICE_SERVERS
      ? JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS)
      : [{ urls: "stun:stun.l.google.com:19302" }];
    let receivedState = false;
    const n = new Network(
      urls,
      (text) => {
        if (started === generation.current) setStatus(text);
      },
      (state) => {
        if (started === generation.current) {
          if (!receivedState)
            soundState.current = {
              moves: [...state.moves],
              winner: state.winner,
            };
          receivedState = true;
          setS(state);
        }
      },
      (value) => {
        if (started !== generation.current) return;
        setInfo(value);
        if (value.connected) {
          setMode("online");
        }
      },
      ice,
    );
    network.current = n;
    return n;
  }
  async function getAI(started: number) {
    setLoading(true);
    try {
      const { loadBrowserAI } = await import("../../lib/browser-ai");
      const model = await loadBrowserAI();
      if (started !== generation.current) return null;
      setAI(model);
      return model;
    } finally {
      if (started === generation.current) setLoading(false);
    }
  }
  async function computer() {
    const started = clear("ai");
    setStatus("Loading computer…");
    try {
      const model = ai || (await getAI(started));
      if (!model || started !== generation.current) return;
      setStatus("Computer ready · your turn");
    } catch (e) {
      if (started === generation.current)
        setStatus(
          `Could not load computer: ${e instanceof Error ? e.message : String(e)}. Use New Game to retry.`,
        );
    }
  }
  async function hostGame(configured = relays) {
    const started = clear("online");
    setStatus("Creating private lobby…");
    try {
      const n = connect(started, configured);
      const code = await n.createPrivate();
      if (started !== generation.current) return;
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("code", code);
      url.searchParams.set("relays", configured);
      setInvite(url.href);
    } catch (e) {
      if (started === generation.current)
        setStatus(
          `Could not host: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
  }
  async function joinInvite(code: string, configured: string) {
    const started = clear("online");
    try {
      await connect(started, configured).join(code);
    } catch (e) {
      if (started === generation.current)
        setStatus(
          `Could not join: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
  }
  function localMove(action: number) {
    setS((previous) => play(previous, action));
  }
  useEffect(() => {
    if (mode !== "ai" || !ai || s.turn !== -1 || s.winner) return;
    let cancelled = false;
    const started = generation.current;
    const stale = () => cancelled || started !== generation.current;
    const id = setTimeout(() => {
      void import("../../lib/browser-ai")
        .then(({ difficultyToSkill }) =>
          ai.move(s, difficultyToSkill(difficulty), stale),
        )
        .then((action) => {
          if (!stale()) {
            setS(play(s, action));
            setStatus("Your turn");
          }
        })
        .catch((e) => {
          if (!stale())
            setStatus(
              `Computer move failed: ${e instanceof Error ? e.message : String(e)}. Use New Game to retry.`,
            );
        });
    }, MOVE_ROUTING_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [s, mode, ai, difficulty]);
  const online = mode === "online",
    timed = online,
    clock = info.deadline,
    side = online
      ? info.role === "host"
        ? 1
        : info.role === "guest"
          ? -1
          : 0
      : 1,
    canPlay =
      !s.winner &&
      !info.ended &&
      (online
        ? info.connected && s.turn === side
        : mode === "ai" && !!ai && !loading && s.turn === 1),
    allowed = legal(s),
    seconds = remainingSeconds(clock, now),
    outcome = info.winner || s.winner,
    showBoard =
      (mode === "ai" && !!ai && !loading) ||
      (online && (clock > 0 || outcome !== 0 || s.moves.length > 0)),
    lastMove = s.moves.at(-1),
    winningBoards =
      Math.abs(s.winner) === 1 ? winningLine(s.boards, s.winner) : undefined,
    turnText = outcome
      ? outcome === 2
        ? "Draw"
        : side === 0
          ? `${outcome === 1 ? "X" : "O"} wins`
          : outcome === side
            ? "You win"
            : "You lose"
      : info.ended
        ? "Game over"
        : online && info.role === "spectator"
          ? `${s.turn === 1 ? "Host (X)" : "Guest (O)"} to move`
          : s.turn === side
            ? "Your turn"
            : "Opponent’s turn";
  useEffect(() => {
    const board = boardRef.current;
    if (!showBoard || !board) return;
    const resize = () =>
      setBoardSize({
        width: board.clientWidth,
        height: board.clientHeight,
        gap: parseFloat(getComputedStyle(board).columnGap) || 0,
      });
    const observer = new ResizeObserver(resize);
    observer.observe(board);
    resize();
    return () => observer.disconnect();
  }, [showBoard]);
  const boardCenter = (index: number) => {
    const width = (boardSize.width - boardSize.gap * 2) / 3,
      height = (boardSize.height - boardSize.gap * 2) / 3;
    return {
      x: (index % 3) * (width + boardSize.gap) + width / 2,
      y: Math.floor(index / 3) * (height + boardSize.gap) + height / 2,
    };
  };
  const winStart = winningBoards ? boardCenter(winningBoards[0]) : null,
    winEnd = winningBoards ? boardCenter(winningBoards[2]) : null;
  useEffect(() => {
    const before = soundState.current;
    if (
      s.moves.length === before.moves.length + 1 &&
      before.moves.every((a, i) => a === s.moves[i])
    ) {
      const mark = s.cells[s.moves[s.moves.length - 1]];
      sounds.current?.play(mark === 1 ? "x" : "o");
    }
    if (
      outcome &&
      outcome !== 2 &&
      outcome !== before.winner &&
      side !== 0 &&
      mode !== "choose"
    ) {
      sounds.current?.play(outcome === side ? "win" : "lose");
    }
    soundState.current = { moves: [...s.moves], winner: outcome };
  }, [s, outcome, side, mode]);
  return (
    <main>
      <header>
        <StatHeader />
        <div className="header-tools">
          <FeedbackButton />
          <button
            className="sound-toggle"
            aria-label={soundOn ? "Mute sounds" : "Enable sounds"}
            aria-pressed={soundOn}
            onClick={() => {
              const enabled = !soundOn;
              setSoundOn(enabled);
              sounds.current?.setEnabled(enabled);
              if (enabled) sounds.current?.unlock();
              try {
                localStorage.setItem(
                  "ultimate-relay-sound",
                  enabled ? "on" : "off",
                );
              } catch {
                /* Storage is optional. */
              }
            }}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </button>
          <span className="badge">NOSTR × WEBRTC</span>
        </div>
      </header>
      <section className="intro">
        <p className="eyebrow">NINE BOARDS. ONE BIGGER GAME.</p>
        <h1>
          Think outside
          <br />
          the square<span>.</span>
        </h1>
        <p>
          Win three small boards in a row. Every move sends your opponent to
          their next board.
        </p>
      </section>
      <div className={`workspace ${showBoard ? "" : "waiting"}`}>
        {showBoard && (
          <section className="arena">
            <div className="score">
              <span className={s.turn === 1 ? "active" : ""}>
                ✕{" "}
                {online
                  ? info.role === "host"
                    ? "You · Host"
                    : "Host"
                  : "You"}
              </span>
              <span>{turnText}</span>
              <span className={s.turn === -1 ? "active o" : ""}>
                ◯{" "}
                {online
                  ? info.role === "guest"
                    ? "You · Guest"
                    : "Guest"
                  : mode === "ai"
                    ? "Computer"
                    : "Opponent"}
              </span>
            </div>
            {timed && clock > 0 && !s.winner && !info.ended && (
              <div className={`turn-clock ${seconds <= 10 ? "urgent" : ""}`}>
                <span>{turnText}</span>
                <strong aria-label="Seconds remaining">{seconds}s</strong>
                <progress
                  aria-label="Turn time remaining"
                  max="60"
                  value={seconds}
                />
              </div>
            )}
            <div className="board" ref={boardRef}>
              {s.boards.map((won, b) => (
                <div
                  key={b}
                  className={`small ${!won && (s.forced < 0 || s.forced === b) && !s.winner ? "eligible" : ""} ${won ? "closed" : ""}`}
                >
                  {Array.from({ length: 9 }, (_, c) => {
                    const a = b * 9 + c;
                    return (
                      <button
                        key={a}
                        aria-label={`Board ${b + 1}, square ${c + 1}${s.cells[a] ? ", " + (s.cells[a] === 1 ? "X" : "O") : ""}`}
                        className={`${s.cells[a] === -1 ? "o" : ""} ${a === lastMove ? "last-move" : ""}`}
                        aria-current={a === lastMove ? "true" : undefined}
                        aria-description={
                          a === lastMove ? "Most recent move" : undefined
                        }
                        disabled={!canPlay || !allowed.includes(a)}
                        onPointerEnter={() => setPreview(a)}
                        onPointerLeave={() => setPreview(null)}
                        onFocus={() => setPreview(a)}
                        onBlur={() => setPreview(null)}
                        onClick={() => {
                          try {
                            if (online) network.current!.move(a);
                            else localMove(a);
                          } catch (e) {
                            setStatus(String(e));
                          }
                        }}
                      >
                        {s.cells[a] === 1 ? "✕" : s.cells[a] === -1 ? "◯" : ""}
                      </button>
                    );
                  })}
                  {won !== 0 && (
                    <div
                      className={`won ${won === -1 ? "o" : ""}`}
                      aria-label={
                        won === 2 ? "Wildcard: counts for X and O" : undefined
                      }
                    >
                      {won === 2 ? "★" : won === 1 ? "✕" : "◯"}
                    </div>
                  )}
                </div>
              ))}
              {winningBoards && winStart && winEnd && boardSize.width > 0 && (
                <svg
                  className={`winning-line ${s.winner === -1 ? "o" : ""}`}
                  role="img"
                  aria-label={`${s.winner === 1 ? "X" : "O"} wins across boards ${winningBoards.map((b) => b + 1).join(", ")}`}
                  viewBox={`0 0 ${boardSize.width} ${boardSize.height}`}
                >
                  <line
                    x1={winStart.x - (winEnd.x - winStart.x) * 0.16}
                    y1={winStart.y - (winEnd.y - winStart.y) * 0.16}
                    x2={winEnd.x + (winEnd.x - winStart.x) * 0.16}
                    y2={winEnd.y + (winEnd.y - winStart.y) * 0.16}
                  />
                </svg>
              )}
              <BoardEffects
                state={s}
                preview={
                  canPlay && preview !== null && allowed.includes(preview)
                    ? preview
                    : null
                }
                result={
                  outcome
                    ? outcome === 2
                      ? "Draw"
                      : side === 0
                        ? `${outcome === 1 ? "X" : "O"} wins`
                        : outcome === side
                          ? "Victory"
                          : "Defeat"
                    : undefined
                }
              />
            </div>
            <p className="hint">
              {info.ended
                ? info.ended
                : s.winner
                  ? "Game complete."
                  : s.forced < 0
                    ? "Free choice · play in any highlighted board."
                    : `Next move · board ${s.forced + 1} is highlighted.`}
            </p>
          </section>
        )}
        <aside>
          <h2>
            {mode === "choose"
              ? "Choose your next rival."
              : mode === "ai"
                ? "Your next challenge."
                : info.role === "spectator" && online && info.connected
                  ? "Watch the game."
                  : "Your next rival."}
          </h2>
          {mode === "choose" ? (
            <>
              <p>Play the computer or invite a friend to a private game.</p>
              <div className="computer-controls">
                <button className="primary" onClick={() => void computer()}>
                  Play the computer
                </button>
                <DifficultyControl
                  difficulty={difficulty}
                  onChange={setDifficulty}
                />
              </div>
              <button className="secondary" onClick={() => void hostGame()}>
                Host game
              </button>
              <details className="relay-settings">
                <summary>Relay settings</summary>
                <label>
                  Relay URLs
                  <input
                    value={relays}
                    onChange={(e) => setRelays(e.target.value)}
                  />
                </label>
              </details>
            </>
          ) : mode === "ai" ? (
            <>
              <DifficultyControl
                difficulty={difficulty}
                onChange={setDifficulty}
              />

              <button
                className="primary"
                disabled={loading}
                onClick={() => void computer()}
              >
                New Game
              </button>
            </>
          ) : (
            <>
              <p>
                {info.connected
                  ? info.role === "spectator"
                    ? "View mode · you can watch but cannot play."
                    : `You are ${info.role === "host" ? "the host (X)" : "the guest (O)"}. Each turn lasts 60 seconds.`
                  : "Private lobby · the first visitor plays, later visitors watch."}
              </p>
              {invite && (
                <div className="invite">
                  <label>
                    Invite link
                    <input
                      readOnly
                      value={invite}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <button
                    className="secondary"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(invite)
                        .then(() => setStatus("Invite link copied"))
                        .catch(() =>
                          setStatus("Select the invite link to copy it"),
                        )
                    }
                  >
                    Copy link
                  </button>
                </div>
              )}
              {info.role === "host" && info.connected && (
                <p>{info.spectators} watching</p>
              )}
              <button className="secondary" onClick={choose}>
                {info.ended
                  ? "New Game"
                  : info.role === "spectator"
                    ? "Leave view"
                    : "Leave game"}
              </button>
            </>
          )}
          <div className="status" role="status">
            <i />
            {status}
          </div>
          <div className="rules">
            <h3>THE RIPPLE EFFECT</h3>
            <ol>
              <li>Pick a square in a highlighted board.</li>
              <li>That square determines your opponent’s next board.</li>
              <li>
                Win a small board to claim it. Claim three in a row to win.
              </li>
            </ol>
            <p>Sent to a finished board? You can play anywhere.</p>
            <p>
              Tied boards become wildcards for X and O. If both win, the player
              who made the wildcard wins. When all boards close, most claimed
              boards wins; a tie goes to X, who played first.
            </p>
            {timed && (
              <p>Out of time? A random legal move is played for you.</p>
            )}
          </div>
        </aside>
      </div>
      <footer>
        BUILT FOR THE LONG GAME <span>81 squares · endless possibilities</span>
      </footer>
    </main>
  );
}

function DifficultyControl({
  difficulty,
  onChange,
}: {
  difficulty: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="difficulty-control">
      <label htmlFor="difficulty">
        Difficulty <strong>{difficulty}/10</strong>
      </label>
      <input
        id="difficulty"
        type="range"
        min="1"
        max="10"
        step="1"
        value={difficulty}
        aria-valuetext={`Difficulty ${difficulty} of 10`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="skill-scale">
        <span>Easy</span>
        <span>Expert</span>
      </div>
    </div>
  );
}
