"use client";
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { authClient } from "./auth-client";

export class ConvexError extends Error {
  data: any;
  constructor(data: any) {
    super(typeof data === "string" ? data : JSON.stringify(data));
    this.name = "ConvexError";
    this.data = data;
  }
}

export const api = {
  royale: {
    dashboard: "royale.dashboard",
    ensureProfile: "royale.ensureProfile",
    join: "royale.join",
    leaveLobby: "royale.leaveLobby",
    move: "royale.move",
    resign: "royale.resign",
    rename: "royale.rename",
    equip: "royale.equip",
  },
  leaderboard: {
    top: "leaderboard.top",
    setOptOut: "leaderboard.setOptOut",
  },
  daily: {
    today: "daily.today",
    attempt: "daily.attempt",
  },
  feedback: {
    send: "feedback.send",
  },
  growth: {
    host: "growth.host",
    room: "growth.room",
    start: "growth.start",
    attribute: "growth.attribute",
    shareResult: "growth.shareResult",
    sharedResult: "growth.sharedResult",
  },
  auth: {
    providers: "auth.providers",
    currentUser: "auth.currentUser",
  },
  telemetry: {
    publicStats: "telemetry.publicStats",
    live: "telemetry.live",
  },
} as const;

const queryListeners = new Set<() => void>();
function notifyQueryListeners() {
  for (const listener of queryListeners) {
    listener();
  }
}

export async function callRpc(name: string, args: any = {}) {
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({ error: "Network error" }));
  if (!res.ok) {
    throw new ConvexError(data?.data || data?.error || "Error");
  }
  return data.result;
}

export class ConvexHttpClient {
  url?: string;
  constructor(url?: string) {
    this.url = url;
  }
  async query(fnName: string, args: any = {}) {
    return callRpc(fnName, args);
  }
  async mutation(fnName: string, args: any = {}) {
    const res = await callRpc(fnName, args);
    notifyQueryListeners();
    return res;
  }
}

export class ConvexReactClient extends ConvexHttpClient {}

export function useMutation(fnName: string) {
  return useCallback(
    async (args: any = {}) => {
      const result = await callRpc(fnName, args);
      notifyQueryListeners();
      return result;
    },
    [fnName],
  );
}

import type { PublicTournament } from "./royale";

export type QueryTypeMap = {
  "leaderboard.top": Array<{
    rank: number;
    name: string;
    points: number;
    crowns: number;
    tier: string;
    level: number;
  }>;
  "royale.dashboard": {
    profile: {
      _id: string;
      id: string;
      name: string;
      points: number;
      xp: number;
      crowns: number;
      cosmetics: string[];
      equipped: { theme: string; title: string; effect: string };
      active?: string;
      last?: string;
      joinedAt: number;
      lastVisitDay?: string;
      playedAt?: number;
      leaderboardOptOut?: boolean;
      leaderboardEligible?: boolean;
      acquisition?: { source: string; campaign: string; at: number };
    };
    tournament: (PublicTournament & { id: string }) | null;
    view: any;
    history: Array<{
      _id: string;
      id: string;
      profile: string;
      tournament: string;
      finish: number;
      delta: number;
      xp: number;
      createdAt: number;
      crown?: boolean;
      entrant?: string;
    }>;
    quests: {
      _id: string;
      id: string;
      profile: string;
      day: string;
      completed: number;
      boards: number;
      wins: number;
      claimed: string[];
    } | null;
    serverNow: number;
    roomCode?: string;
    isHost?: boolean;
  };
  "daily.today": {
    day: string;
    state: any;
    attempts: number[];
    solved: boolean;
    done: boolean;
    solution?: number;
  };
  "growth.room": {
    open: boolean;
    count: number;
  } | null;
  "auth.providers": {
    vercel: boolean;
    google: boolean;
  };
};

export function useQuery<K extends keyof QueryTypeMap>(
  fnName: K,
  args?: any,
): QueryTypeMap[K] | undefined;
export function useQuery<T = any>(
  fnName: string,
  args?: any,
): T | undefined;
export function useQuery(fnName: string, args: any = {}) {
  const isSkip = args === "skip";
  const [data, setData] = useState<any>(undefined);
  const argsJson = JSON.stringify(args);

  const fetchCurrent = useCallback(async () => {
    if (isSkip) return;
    try {
      const parsedArgs = argsJson ? JSON.parse(argsJson) : {};
      const result = await callRpc(fnName, parsedArgs);
      setData(result);
    } catch {
      // Keep previous data on transient poll error
    }
  }, [fnName, argsJson, isSkip]);

  useEffect(() => {
    if (isSkip) return;
    void fetchCurrent();

    const onInvalidate = () => {
      void fetchCurrent();
    };
    queryListeners.add(onInvalidate);

    let intervalMs = 10000;
    if (fnName === "royale.dashboard") {
      intervalMs = 400;
    } else if (fnName === "growth.room") {
      intervalMs = 800;
    } else if (fnName === "daily.today") {
      intervalMs = 15000;
    }

    const timer = setInterval(() => {
      void fetchCurrent();
    }, intervalMs);

    const onFocus = () => {
      void fetchCurrent();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("visibilitychange", onFocus);

    return () => {
      queryListeners.delete(onInvalidate);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("visibilitychange", onFocus);
    };
  }, [fnName, argsJson, isSkip, fetchCurrent]);

  return isSkip ? undefined : data;
}

export function useConvexAuth() {
  const session = authClient.useSession();
  return {
    isAuthenticated: !!session.data?.user,
    isLoading: session.isPending,
  };
}

export function ConvexProvider({
  client,
  children,
}: {
  client?: any;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

export function ConvexBetterAuthProvider({
  client,
  authClient,
  children,
}: {
  client?: any;
  authClient?: any;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
