import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

function authHandler() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexUrl || !convexSiteUrl) return null;
  return convexBetterAuthNextJs({ convexUrl, convexSiteUrl }).handler;
}
export async function GET(request: Request) {
  const handler = authHandler();
  return handler ? handler.GET(request) : Response.json({ error: "Royale is being configured" }, { status: 503 });
}
export async function POST(request: Request) {
  const handler = authHandler();
  return handler ? handler.POST(request) : Response.json({ error: "Royale is being configured" }, { status: 503 });
}
