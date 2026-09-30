import { query } from "../db";

export async function currentUser(authId?: string | null) {
  if (!authId) return null;
  const res = await query('SELECT * FROM "user" WHERE id = $1', [authId]);
  const user = res.rows[0];
  if (!user) return null;
  return {
    _id: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    isAnonymous: user.isAnonymous,
  };
}

export async function providers() {
  return {
    vercel: !!(
      process.env.VERCEL_CLIENT_ID && process.env.VERCEL_CLIENT_SECRET
    ),
    google: !!(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
  };
}
