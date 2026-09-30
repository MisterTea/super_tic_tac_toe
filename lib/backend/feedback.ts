import { query, withTransaction } from "../db";
import { ApiError } from "./royale";

export async function send(args: {
  message: string;
  category: "Bug" | "Idea" | "Other";
  email?: string;
  page: string;
  client: string;
  request: string;
  website?: string;
}) {
  if (args.website) return { accepted: true };
  const message = (args.message || "").trim();
  const email = (args.email || "").trim();
  if (message.length < 10 || message.length > 3000) {
    throw new ApiError("Please write 10–3,000 characters of feedback.");
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ApiError("Please enter a valid email address or leave it blank.");
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(args.client) ||
    !uuid.test(args.request) ||
    args.page.length > 200 ||
    !/^\/[a-z0-9/_-]*$/i.test(args.page)
  ) {
    throw new ApiError("Please refresh the page and try again.");
  }

  return withTransaction(async (dbClient) => {
    const prior = await dbClient.query(
      "SELECT 1 FROM feedback WHERE request = $1",
      [args.request],
    );
    if (prior.rows.length > 0) return { accepted: true };

    const now = Date.now();
    const recent = await dbClient.query(
      "SELECT 1 FROM feedback WHERE client = $1 AND created_at >= $2 LIMIT 3",
      [args.client, now - 3600_000],
    );
    if (recent.rows.length >= 3) {
      throw new ApiError(
        "Thanks for your feedback. Please wait an hour before sending more.",
      );
    }

    const id = crypto.randomUUID();
    await dbClient.query(
      `INSERT INTO feedback (id, message, category, email, page, created_at, client, request)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, message, args.category, email || null, args.page, now, args.client, args.request],
    );
    return { accepted: true };
  });
}
