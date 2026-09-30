import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
async function main() {
  const { query, getPool } = await import("../lib/db");
  try {
    await query(`
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS username TEXT;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "displayUsername" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS user_username_unique ON "user" (username);
  `);
    console.log("Username account schema is ready.");
  } finally {
    await getPool().end();
  }
}
main().catch(() => {
  console.error("Auth schema migration failed.");
  process.exitCode = 1;
});
