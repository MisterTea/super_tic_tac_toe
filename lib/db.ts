import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let poolInstance: Pool | null = null;

export function getPool(): Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString?.trim()) {
      throw new Error(
        "DATABASE_URL is required. Set it in .env.local or Vercel environment variables.",
      );
    }
    poolInstance = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return poolInstance;
}

export const pool = getPool();

export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, params);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function initDb() {
  await withTransaction(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL,
        "isAnonymous" BOOLEAN DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS "session" (
        id TEXT PRIMARY KEY,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        token TEXT NOT NULL UNIQUE,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS "account" (
        id TEXT PRIMARY KEY,
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "accessToken" TEXT,
        "refreshToken" TEXT,
        "idToken" TEXT,
        "accessTokenExpiresAt" TIMESTAMPTZ,
        "refreshTokenExpiresAt" TIMESTAMPTZ,
        scope TEXT,
        password TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "verification" (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        auth_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        points INT NOT NULL DEFAULT 0,
        xp INT NOT NULL DEFAULT 0,
        crowns INT NOT NULL DEFAULT 0,
        cosmetics JSONB NOT NULL DEFAULT '[]'::jsonb,
        equipped JSONB NOT NULL DEFAULT '{"theme":"classic","title":"Novice","effect":"none"}'::jsonb,
        active TEXT,
        last TEXT,
        joined_at BIGINT NOT NULL,
        last_visit_day TEXT,
        played_at BIGINT,
        leaderboard_opt_out BOOLEAN DEFAULT false,
        leaderboard_eligible BOOLEAN DEFAULT false,
        acquisition JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_profiles_leaderboard
        ON profiles(leaderboard_eligible, points DESC, crowns DESC, xp DESC);

      CREATE TABLE IF NOT EXISTS tournaments (
        id TEXT PRIMARY KEY,
        tier INT NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        state JSONB NOT NULL,
        updated_at BIGINT NOT NULL,
        room_code TEXT UNIQUE,
        host TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tournaments_status_tier
        ON tournaments(status, tier);

      CREATE TABLE IF NOT EXISTS rewards (
        id TEXT PRIMARY KEY,
        profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        tournament TEXT NOT NULL,
        finish INT NOT NULL,
        delta INT NOT NULL,
        xp INT NOT NULL,
        created_at BIGINT NOT NULL,
        crown BOOLEAN DEFAULT false,
        entrant TEXT,
        UNIQUE(profile, tournament)
      );

      CREATE INDEX IF NOT EXISTS idx_rewards_profile
        ON rewards(profile);

      CREATE TABLE IF NOT EXISTS quests (
        id TEXT PRIMARY KEY,
        profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        completed INT NOT NULL DEFAULT 0,
        boards INT NOT NULL DEFAULT 0,
        wins INT NOT NULL DEFAULT 0,
        claimed JSONB NOT NULL DEFAULT '[]'::jsonb,
        UNIQUE(profile, day)
      );

      CREATE TABLE IF NOT EXISTS daily_attempts (
        id TEXT PRIMARY KEY,
        profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
        solved BOOLEAN NOT NULL DEFAULT false,
        UNIQUE(profile, day)
      );

      CREATE TABLE IF NOT EXISTS name_claims (
        key TEXT PRIMARY KEY,
        owner TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        category TEXT NOT NULL,
        email TEXT,
        page TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        client TEXT NOT NULL,
        request TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_client_created
        ON feedback(client, created_at);

      CREATE TABLE IF NOT EXISTS shared_results (
        id TEXT PRIMARY KEY,
        reward TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        finish INT NOT NULL,
        wins INT NOT NULL,
        crown BOOLEAN NOT NULL DEFAULT false,
        delta INT NOT NULL,
        rounds JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        tournament TEXT,
        at BIGINT NOT NULL,
        value DOUBLE PRECISION
      );

      CREATE INDEX IF NOT EXISTS idx_events_kind_at
        ON events(kind, at);

      CREATE TABLE IF NOT EXISTS metric_facts (
        key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        values JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS metric_rollups (
        bucket TEXT PRIMARY KEY,
        values JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS campaign_metrics (
        source TEXT NOT NULL,
        campaign TEXT NOT NULL,
        bucket TEXT NOT NULL,
        values JSONB NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (source, campaign, bucket)
      );

      CREATE INDEX IF NOT EXISTS idx_campaign_metrics_bucket
        ON campaign_metrics(bucket);

      CREATE TABLE IF NOT EXISTS player_activity (
        profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        PRIMARY KEY (profile, day)
      );
    `);
  });
}
