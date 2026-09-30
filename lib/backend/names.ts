import type { PoolClient } from "pg";
import { getPool, query } from "../db";
import { displayName, generatePlayerName, nameKey } from "../player-names";

export async function claimName(
  client: PoolClient | null,
  name: string,
  owner: string,
): Promise<boolean> {
  const key = nameKey(name);
  const q = client ? client.query.bind(client) : query;
  const res = await q("SELECT owner FROM name_claims WHERE key = $1", [key]);
  if (res.rows.length > 0) {
    return res.rows[0].owner === owner;
  }
  await q(
    "INSERT INTO name_claims (key, owner) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
    [key, owner],
  );
  const check = await q("SELECT owner FROM name_claims WHERE key = $1", [key]);
  return check.rows[0]?.owner === owner;
}

export async function generatedName(
  client: PoolClient | null,
  owner: string,
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = generatePlayerName();
    if (await claimName(client, name, owner)) return name;
  }
  throw new Error("Could not find an available name. Please try again.");
}

export async function migrateNames(): Promise<{ profiles: number; renamed: number }> {
  let renamed = 0;
  const rows = (await query("SELECT id, name FROM profiles")).rows;
  for (const p of rows) {
    let name: string;
    try {
      name = displayName(p.name);
    } catch {
      name = await generatedName(null, p.id);
    }
    if (!(await claimName(null, name, p.id))) {
      name = await generatedName(null, p.id);
    }
    if (name !== p.name) {
      await query("UPDATE profiles SET name = $1 WHERE id = $2", [name, p.id]);
      renamed++;
    }
  }
  return { profiles: rows.length, renamed };
}
