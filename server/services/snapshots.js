// Snapshot persistence with dedup (design §11) - User-specific
import crypto from "node:crypto";
import { pool } from "../db/database.js";

const hash = (c) =>
  crypto.createHash("sha1")
    .update(JSON.stringify([c.bumpkin.xp, c.farmActivity, c.inventory]))
    .digest("hex");

export async function save(canonical, userId) {
  if (!userId) {
    console.warn('No userId provided for snapshot save');
    return { saved: false, reason: "no_user" };
  }

  const h = hash(canonical);
  
  // Check if last snapshot for this user is the same
  const last = await pool.query(
    "SELECT state_hash FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  
  if (last.rows[0]?.state_hash === h) {
    return { saved: false, reason: "unchanged" };
  }

  await pool.query(
    "INSERT INTO snapshots (user_id, created_at, xp, flower, coins, state_hash, data_json) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [userId, Date.now(), canonical.bumpkin.xp, canonical.currencies.flower, canonical.currencies.coins, h, canonical]
  );
  
  return { saved: true };
}

export async function latest(n = 2, userId) {
  if (!userId) {
    console.warn('No userId provided for latest snapshots');
    return [];
  }

  const r = await pool.query(
    "SELECT created_at, data_json FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, n]
  );
  
  return r.rows.map((row) => row.data_json);
}
