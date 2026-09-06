// Snapshot persistence with dedup (design §11)
import crypto from "node:crypto";
import { pool } from "../db/database.js";

const hash = (c) =>
  crypto.createHash("sha1")
    .update(JSON.stringify([c.bumpkin.xp, c.farmActivity, c.inventory]))
    .digest("hex");

export async function save(canonical) {
  const h = hash(canonical);
  const last = await pool.query("SELECT state_hash FROM snapshots ORDER BY created_at DESC LIMIT 1");
  if (last.rows[0]?.state_hash === h) return { saved: false, reason: "unchanged" };
  await pool.query(
    "INSERT INTO snapshots (created_at, xp, flower, coins, state_hash, data_json) VALUES ($1,$2,$3,$4,$5,$6)",
    [Date.now(), canonical.bumpkin.xp, canonical.currencies.flower, canonical.currencies.coins, h, canonical]
  );
  return { saved: true };
}

export async function latest(n = 2) {
  const r = await pool.query("SELECT created_at, data_json FROM snapshots ORDER BY created_at DESC LIMIT $1", [n]);
  return r.rows.map((row) => row.data_json);
}
