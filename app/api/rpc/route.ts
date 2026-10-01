import { auth } from "../../../lib/auth";
import * as royale from "../../../lib/backend/royale";
import * as leaderboard from "../../../lib/backend/leaderboard";
import * as daily from "../../../lib/backend/daily";
import * as feedback from "../../../lib/backend/feedback";
import * as growth from "../../../lib/backend/growth";
import * as authBackend from "../../../lib/backend/auth";
import * as telemetry from "../../../lib/backend/telemetry";

async function handleRpc(name: string, args: any, request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const authId = session?.user?.id || null;
  const isAnonymous = !!session?.user?.isAnonymous;

  switch (name) {
    // Royale
    case "royale.dashboard":
      if (!authId) return null;
      return await royale.dashboard(authId);
    case "royale.ensureProfile":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await royale.ensureProfile(authId, isAnonymous);
    case "royale.join":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await royale.join(authId, args?.roomCode);
    case "royale.leaveLobby":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await royale.leaveLobby(authId);
    case "royale.move":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await royale.move(
        authId,
        args.tournament,
        args.match,
        args.seq,
        args.action,
      );
    case "royale.resign":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await royale.resign(authId, args.tournament);
    case "royale.rename":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await royale.rename(authId, args.name, isAnonymous);
    case "royale.equip":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await royale.equip(authId, args.id);

    // Leaderboard
    case "leaderboard.top":
      return await leaderboard.top();
    case "leaderboard.setOptOut":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await leaderboard.setOptOut(authId, args.optOut, isAnonymous);

    // Daily
    case "daily.today":
      if (!authId) return null;
      return await daily.today(authId);
    case "daily.attempt":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await daily.attempt(authId, args.day, args.action);

    // Feedback
    case "feedback.send":
      return await feedback.send(args);

    // Growth
    case "growth.host":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await growth.host(authId);
    case "growth.room":
      return await growth.room(args?.code);
    case "growth.start":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await growth.start(authId);
    case "growth.attribute":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await growth.attribute(authId, args.source, args.campaign);
    case "growth.shareResult":
      if (!authId) throw new royale.ApiError("Unauthorized");
      return await growth.shareResult(authId, args.tournament);
    case "growth.sharedResult":
      return await growth.sharedResult(args.token);

    // Auth
    case "auth.providers":
      return await authBackend.providers();
    case "auth.currentUser":
      return await authBackend.currentUser(authId);

    // Telemetry
    case "telemetry.publicStats":
      return await telemetry.publicStats();
    case "telemetry.live":
      return await telemetry.live();

    default:
      throw new royale.ApiError(`Unknown function: ${name}`);
  }
}

async function loggedRpc(name: string, args: any, request: Request) {
  const started = Date.now();
  const action =
    typeof name === "string" && /^[a-z.]{1,64}$/i.test(name) ? name : "unknown";
  try {
    return await handleRpc(name, args, request);
  } catch (error) {
    if (!(error instanceof royale.ApiError))
      console.error("[rpc] failed", {
        action,
        code: (error as { code?: string }).code || "UNKNOWN",
        elapsedMs: Date.now() - started,
      });
    throw error;
  } finally {
    if (Date.now() - started > 2000)
      console.warn("[rpc] slow_request", {
        action,
        elapsedMs: Date.now() - started,
      });
  }
}
function rpcError(error: unknown) {
  const expected = error instanceof royale.ApiError;
  const message = expected
    ? error.message
    : "Connection interrupted. Please try again.";
  return Response.json(
    { error: message, data: expected ? error.data : message },
    { status: expected ? 400 : 503 },
  );
}
export async function POST(request: Request) {
  try {
    const { name, args } = await request.json();
    const result = await loggedRpc(name, args, request);
    return Response.json({ result });
  } catch (error: any) {
    return rpcError(error);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name") || "";
    const rawArgs = searchParams.get("args");
    const args = rawArgs ? JSON.parse(rawArgs) : {};
    const result = await loggedRpc(name, args, request);
    return Response.json({ result });
  } catch (error: any) {
    return rpcError(error);
  }
}
