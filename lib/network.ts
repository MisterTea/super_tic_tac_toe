import {
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  nip44,
  type Event,
} from "nostr-tools";
import { initial, legal, play, replay, State } from "./game";
const topic = "ultimate-relay-v2",
  kind = 20078;
export type Role = "host" | "guest" | "spectator";
export type SessionInfo = {
  winner: number;
  role: Role;
  connected: boolean;
  deadline: number;
  ended: string;
  spectators: number;
};
type Peer = {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  role: Role;
  pending: RTCIceCandidateInit[];
  lastSeen: number;
};
type PoolEntry = { token: string; expires: number };
export class Network {
  private pool = new SimplePool();
  private key = generateSecretKey();
  readonly pubkey = getPublicKey(this.key);
  private subscription: { close: () => void };
  private peers = new Map<string, Peer>();
  private seen = new Set<string>();
  private candidates = new Map<string, PoolEntry>();
  private withdrawn = new Set<string>();
  private history = initial();
  private role: Role = "spectator";
  private hostKey = "";
  private guest = "";
  private code = "";
  private ended = "";
  private winner = 0;
  private started = false;
  private deadline = 0;
  private searching = false;
  private queueToken = "";
  private expires = 0;
  private closed = false;
  private matchTimer?: ReturnType<typeof setTimeout>;
  private joinTimer?: ReturnType<typeof setInterval>;
  private heartbeat: ReturnType<typeof setInterval>;
  get connected() {
    return this.role === "host"
      ? !!this.guest &&
          this.peers.get(this.guest)?.channel?.readyState === "open"
      : this.peers.get(this.hostKey)?.channel?.readyState === "open";
  }
  constructor(
    private relays: string[],
    private status: (s: string) => void,
    private update: (s: State) => void,
    private info: (i: SessionInfo) => void,
    private iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
    ],
  ) {
    this.subscription = this.pool.subscribeMany(
      relays,
      {
        kinds: [kind],
        "#t": [topic],
        since: Math.floor(Date.now() / 1000) - 35,
      },
      {
        onevent: (e) => {
          void this.receive(e).catch(() => {
            if (!this.closed)
              this.status("Signaling failed · check relay connection");
          });
        },
      },
    );
    this.heartbeat = setInterval(() => this.tick(), 1000);
  }
  private emit() {
    this.info({
      winner: this.winner || this.history.winner,
      role: this.role,
      connected: this.connected,
      deadline: this.deadline,
      ended: this.ended,
      spectators: [...this.peers.values()].filter(
        (p) => p.role === "spectator" && p.channel?.readyState === "open",
      ).length,
    });
  }
  private async publish(data: object, to?: string) {
    if (this.closed) throw new Error("Connection closed");
    const content = to
      ? JSON.stringify({
          sealed: nip44.v2.encrypt(
            JSON.stringify(data),
            nip44.v2.utils.getConversationKey(this.key, to),
          ),
        })
      : JSON.stringify(data);
    const event = finalizeEvent(
      {
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["t", topic], ...(to ? [["p", to]] : [])],
        content,
      },
      this.key,
    );
    await Promise.any(this.pool.publish(this.relays, event));
  }
  async createPrivate() {
    this.role = "host";
    this.hostKey = this.pubkey;
    this.code = `${this.pubkey}.${Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2, "0")).join("")}`;
    // A private lobby is announced only to this host: no public room advertisement or invite secret.
    await this.publish({ type: "lobby", code: this.code }, this.pubkey);
    if (this.closed) throw new Error("Connection closed");
    this.emit();
    this.status("Private lobby ready · waiting for a guest");
    return this.code;
  }
  async join(code: string) {
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(code))
      throw new Error("Invalid invite code");
    this.code = code;
    this.hostKey = code.split(".")[0];
    this.role = "spectator";
    this.status("Joining private lobby…");
    const send = () =>
      this.publish({ type: "join", code }, this.hostKey).catch(() =>
        this.status("Host unavailable · retry the invite"),
      );
    await send();
    if (this.closed) return;
    this.joinTimer = setInterval(() => {
      if (!this.peers.has(this.hostKey)) void send();
    }, 2000);
    this.emit();
  }
  async findRandom() {
    this.searching = true;
    this.status("Searching for game");
    // Let the subscription discover waiting clients before publishing our own pool entry.
    this.matchTimer = setTimeout(() => {
      void this.tryCandidate();
    }, 800);
  }
  private async tryCandidate() {
    if (!this.searching || this.closed) return;
    const list = [...this.candidates].filter(
      ([key, p]) =>
        key !== this.pubkey &&
        p.expires > Date.now() &&
        !this.withdrawn.has(`${key}:${p.token}`),
    );
    if (!list.length) {
      await this.enterPool();
      return;
    }
    const [target, entry] = list[Math.floor(Math.random() * list.length)];
    this.withdraw();
    try {
      const code = await this.createPrivate();
      if (this.closed) return;
      this.status("Connecting to opponent…");
      await this.publish({ type: "claim", token: entry.token, code }, target);
      this.matchTimer = setTimeout(() => {
        if (!this.connected && !this.closed) {
          this.clearRoom();
          this.searching = true;
          void this.enterPool();
        }
      }, 3000);
    } catch {
      if (!this.closed) {
        this.clearRoom();
        this.searching = true;
        await this.enterPool();
      }
    }
  }
  private async enterPool() {
    if (!this.searching || this.closed) return;
    this.queueToken = crypto.randomUUID();
    this.expires = Date.now() + 30000;
    this.status("Searching for game");
    try {
      await this.publish({
        type: "available",
        token: this.queueToken,
        expires: this.expires,
      });
    } catch {
      if (!this.closed) this.status("Searching for game · relay unavailable");
    }
  }
  private withdraw() {
    if (this.queueToken) {
      void this.publish({ type: "withdraw", token: this.queueToken }).catch(
        () => {},
      );
      this.withdrawn.add(`${this.pubkey}:${this.queueToken}`);
    }
    this.queueToken = "";
    this.searching = false;
  }
  private setup(key: string, role: Role) {
    const code = this.code;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, role, pending: [], lastSeen: Date.now() };
    this.peers.set(key, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        void this.publish(
          { type: "ice", code, candidate: e.candidate.toJSON() },
          key,
        ).catch(() => {});
    };
    pc.ondatachannel = (e) => this.attach(key, e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.departure(key);
    };
    return peer;
  }
  private attach(key: string, channel: RTCDataChannel) {
    const peer = this.peers.get(key)!;
    peer.channel = channel;
    channel.onopen = () => {
      peer.lastSeen = Date.now();
      if (this.role === "guest") this.started = true;
      if (this.role === "host") {
        if (key === this.guest && !this.deadline && !this.ended)
          this.deadline = Date.now() + 60000;
        if (key === this.guest) this.started = true;
        this.broadcast();
      }
      this.emit();
      if (!this.ended)
        this.status(
          this.role === "spectator"
            ? "Watching · live game"
            : "Connected · encrypted peer-to-peer",
        );
      clearTimeout(this.matchTimer);
      clearInterval(this.joinTimer);
    };
    channel.onclose = () => this.departure(key);
    channel.onmessage = (e) => {
      if (this.closed) return;
      peer.lastSeen = Date.now();
      try {
        const m = JSON.parse(e.data);
        if (m.type === "ping") return;
        if (m.type === "leave") {
          this.departure(key);
          return;
        }
        if (this.role === "host") {
          this.expireTurn();
          if (
            m.type !== "move" ||
            key !== this.guest ||
            peer.role !== "guest" ||
            this.history.turn !== -1 ||
            m.seq !== this.history.moves.length ||
            this.ended ||
            !this.connected
          )
            return;
          this.apply(m.action);
        } else if (key === this.hostKey && m.type === "state") {
          const next = replay(m.moves);
          if (
            next.moves.length < this.history.moves.length ||
            this.history.moves.some((a, i) => a !== next.moves[i])
          )
            throw new Error("History mismatch");
          this.history = next;
          this.deadline = m.deadline;
          this.ended = typeof m.ended === "string" ? m.ended : "";
          this.started = m.started === true;
          this.winner =
            this.ended && (m.winner === 1 || m.winner === -1)
              ? m.winner
              : next.winner;
          this.update(next);
          this.emit();
          if (this.ended) this.status(this.ended);
        }
      } catch {
        this.departure(key);
        peer.pc.close();
      }
    };
  }
  private broadcast() {
    const payload = JSON.stringify({
      type: "state",
      moves: this.history.moves,
      deadline: this.deadline,
      ended: this.ended,
      winner: this.winner || this.history.winner,
      started: this.started,
    });
    for (const peer of this.peers.values())
      if (peer.channel?.readyState === "open") peer.channel.send(payload);
    this.update(this.history);
    this.emit();
  }
  private apply(action: number) {
    this.history = play(this.history, action);
    this.deadline = this.history.winner ? 0 : Date.now() + 60000;
    this.broadcast();
  }
  move(action: number) {
    if (this.ended || !this.connected) throw new Error("Game is not active");
    if (this.role === "spectator") throw new Error("Spectators cannot play");
    if (this.role === "host" && this.expireTurn())
      throw new Error("Time expired · random move played");
    if (this.history.turn !== (this.role === "host" ? 1 : -1))
      throw new Error("Wait for your turn");
    if (this.role === "host") this.apply(action);
    else {
      play(this.history, action);
      this.peers.get(this.hostKey)!.channel!.send(
        JSON.stringify({
          type: "move",
          seq: this.history.moves.length,
          action,
        }),
      );
    }
  }
  private end(reason: string, winner = 0) {
    if (this.ended) return;
    this.ended = reason;
    this.winner = this.history.winner || winner;
    this.deadline = 0;
    this.status(reason);
    this.broadcast();
    // A signed, encrypted end notice also reaches peers whose data channel just failed.
    if (this.role === "host")
      for (const key of this.peers.keys())
        void this.publish(
          { type: "ended", code: this.code, reason, winner: this.winner },
          key,
        ).catch(() => {});
  }
  private departure(key: string) {
    if (this.closed) return;
    const peer = this.peers.get(key);
    if (!peer) return;
    if (this.role === "host" && key === this.guest)
      this.end(
        this.started && !this.history.winner
          ? "Game over · guest left · X wins by abandonment"
          : "Game over · guest left",
        this.started ? 1 : 0,
      );
    else if (this.role !== "host" && key === this.hostKey && !this.ended) {
      this.winner = this.history.winner || (this.started ? -1 : 0);
      this.ended =
        this.started && !this.history.winner
          ? "Game over · host left · O wins by abandonment"
          : "Game over · host left";
      this.deadline = 0;
      this.status(this.ended);
      this.emit();
    }
    this.peers.delete(key);
    peer.pc.close();
    this.emit();
  }
  private expireTurn(): boolean {
    if (
      this.role !== "host" ||
      !this.connected ||
      this.ended ||
      !this.deadline ||
      Date.now() < this.deadline
    )
      return false;
    const moves = legal(this.history);
    if (moves.length)
      this.apply(moves[Math.floor(Math.random() * moves.length)]);
    return true;
  }
  private tick() {
    if (this.closed) return;
    this.expireTurn();
    if (this.queueToken && this.searching) {
      if (Date.now() >= this.expires) this.withdraw();
      else if (Math.floor(Date.now() / 1000) % 3 === 0)
        void this.publish({
          type: "available",
          token: this.queueToken,
          expires: this.expires,
        }).catch(() => {});
    }
    for (const [key, peer] of this.peers) {
      if (peer.channel?.readyState === "open") {
        peer.channel.send(JSON.stringify({ type: "ping" }));
        if (Date.now() - peer.lastSeen > 12000) this.departure(key);
      } else if (Date.now() - peer.lastSeen > 15000) this.departure(key);
    }
  }
  private async receive(e: Event) {
    if (
      this.closed ||
      e.pubkey === this.pubkey ||
      this.seen.has(e.id) ||
      !verifyEvent(e) ||
      Math.abs(Date.now() / 1000 - e.created_at) > 45 ||
      e.content.length > 30000
    )
      return;
    this.seen.add(e.id);
    if (this.seen.size > 3000) this.seen.clear();
    let m;
    try {
      m = JSON.parse(e.content);
      if (m.sealed) {
        if (!e.tags.some((t) => t[0] === "p" && t[1] === this.pubkey)) return;
        m = JSON.parse(
          nip44.v2.decrypt(
            m.sealed,
            nip44.v2.utils.getConversationKey(this.key, e.pubkey),
          ),
        );
      } else {
        if (
          m.type === "available" &&
          typeof m.token === "string" &&
          Number.isFinite(m.expires) &&
          m.expires > Date.now() &&
          m.expires < Date.now() + 35000 &&
          !this.withdrawn.has(`${e.pubkey}:${m.token}`)
        ) {
          this.candidates.set(e.pubkey, { token: m.token, expires: m.expires });
          // Break simultaneous claims deterministically once both clients are queued.
          if (this.searching && this.queueToken && this.pubkey < e.pubkey)
            void this.tryCandidate();
        }
        if (m.type === "withdraw" && typeof m.token === "string") {
          this.withdrawn.add(`${e.pubkey}:${m.token}`);
          if (this.candidates.get(e.pubkey)?.token === m.token)
            this.candidates.delete(e.pubkey);
        }
        return;
      }
    } catch {
      return;
    }
    if (this.closed) return;
    if (
      m.type === "claim" &&
      this.searching &&
      this.queueToken === m.token &&
      Date.now() < this.expires &&
      typeof m.code === "string" &&
      m.code.split(".")[0] === e.pubkey
    ) {
      this.withdraw();
      await this.join(m.code);
      return;
    }
    if (!this.code || m.code !== this.code) return;
    if (m.type === "join" && this.role === "host") {
      if (this.peers.has(e.pubkey)) return;
      if (this.peers.size >= 32) return;
      const role: Role = !this.guest && !this.ended ? "guest" : "spectator";
      if (role === "guest") this.guest = e.pubkey;
      const peer = this.setup(e.pubkey, role);
      this.emit();
      this.attach(e.pubkey, peer.pc.createDataChannel("moves"));
      // Create the channel before generating SDP so the offer includes SCTP.
      const withChannel = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(withChannel);
      await this.publish(
        { type: "offer", code: this.code, role, sdp: withChannel },
        e.pubkey,
      );
      return;
    }
    if (
      m.type === "offer" &&
      e.pubkey === this.hostKey &&
      this.role !== "host" &&
      !this.peers.has(e.pubkey) &&
      (m.role === "guest" || m.role === "spectator")
    ) {
      this.role = m.role;
      const peer = this.setup(e.pubkey, "host");
      await peer.pc.setRemoteDescription(m.sdp);
      // ICE can arrive before the offer; candidates are collected separately below.
      for (const c of this.earlyIce.get(e.pubkey) || [])
        await peer.pc.addIceCandidate(c);
      this.earlyIce.delete(e.pubkey);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await this.publish(
        { type: "answer", code: this.code, sdp: answer },
        e.pubkey,
      );
      this.emit();
      return;
    }
    const peer = this.peers.get(e.pubkey);
    if (
      m.type === "ended" &&
      e.pubkey === this.hostKey &&
      typeof m.reason === "string"
    ) {
      this.ended = m.reason;
      this.winner =
        this.history.winner ||
        (m.winner === 1 || m.winner === -1 ? m.winner : 0);
      this.deadline = 0;
      this.status(m.reason);
      this.emit();
      return;
    }
    if (m.type === "leave") {
      this.departure(e.pubkey);
      return;
    }
    if (
      m.type === "answer" &&
      this.role === "host" &&
      peer &&
      !peer.pc.remoteDescription
    ) {
      await peer.pc.setRemoteDescription(m.sdp);
      for (const c of peer.pending) await peer.pc.addIceCandidate(c);
      peer.pending = [];
    } else if (m.type === "ice") {
      if (peer?.pc.remoteDescription)
        await peer.pc.addIceCandidate(m.candidate);
      else if (peer && peer.pending.length < 100)
        peer.pending.push(m.candidate);
      else if (e.pubkey === this.hostKey) {
        const list = this.earlyIce.get(e.pubkey) || [];
        if (list.length < 100) list.push(m.candidate);
        this.earlyIce.set(e.pubkey, list);
      }
    }
  }
  private earlyIce = new Map<string, RTCIceCandidateInit[]>();
  private clearRoom() {
    const peers = [...this.peers.values()];
    this.peers.clear();
    for (const p of peers) {
      p.channel?.close();
      p.pc.close();
    }
    this.code = "";
    this.guest = "";
    this.hostKey = "";
    this.role = "spectator";
    this.deadline = 0;
    this.ended = "";
    this.winner = 0;
    this.started = false;
    this.earlyIce.clear();
    this.history = initial();
    this.emit();
  }
  close() {
    if (this.closed) return;
    this.withdraw();
    for (const [key, peer] of this.peers) {
      if (peer.channel?.readyState === "open")
        peer.channel.send(JSON.stringify({ type: "leave" }));
      void this.publish({ type: "leave", code: this.code }, key).catch(
        () => {},
      );
    }
    this.closed = true;
    clearInterval(this.heartbeat);
    clearInterval(this.joinTimer);
    clearTimeout(this.matchTimer);
    const peers = [...this.peers.values()];
    this.peers.clear();
    for (const p of peers) {
      p.channel?.close();
      p.pc.close();
    }
    // Give explicit leave/withdraw events a chance to reach the relay before closing sockets.
    setTimeout(() => {
      this.subscription.close();
      this.pool.close(this.relays);
    }, 200);
  }
}
