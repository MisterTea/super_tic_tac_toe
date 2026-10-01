import { recover } from "../../../../lib/backend/royale";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return Response.json(
      { error: "Watchdog is not configured" },
      { status: 503 },
    );
  if (request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await recover();
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch {
    console.error("[royale] watchdog_scan_failed");
    return Response.json({ error: "Watchdog scan failed" }, { status: 503 });
  }
}
