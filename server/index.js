import "dotenv/config";
import express from "express";
import cors from "cors";
import { init } from "./db/database.js";
import { getFarm, getPrices } from "./services/sunflower.js";
import { plan } from "./services/planner.js";
import { diffActivity } from "./services/activity.js";
import { save, latest } from "./services/snapshots.js";
import { runAgent } from "./services/orchestrator.js";
import { saveMessage, listSessions, getSession } from "./services/chatStore.js";
import recipes from "./data/recipes.json" with { type: "json" };
import items from "./data/items.json" with { type: "json" };
import modifiers from "./data/modifiers.json" with { type: "json" };

const app = express();
app.use(cors(), express.json());
const L100 = 24083905;

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => res.status(502).json({ error: String(e.message ?? e) }));

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.get("/api/farm", wrap(async (_, res) => {
  const { canonical, stale } = await getFarm();
  await save(canonical).catch(() => {}); // DB optional in dev
  res.json({ ...canonical, stale, target: { level: 100, xp: L100, remaining: Math.max(L100 - canonical.bumpkin.xp, 0) } });
}));

app.get("/api/market", wrap(async (_, res) => {
  const { prices, updatedAt, stale } = await getPrices();
  res.json({ prices, items, updatedAt, stale });
}));

app.get("/api/planner", wrap(async (_, res) => {
  const [{ canonical }, { prices }] = await Promise.all([getFarm(), getPrices()]);
  res.json(plan(canonical, prices, recipes, items, modifiers));
}));

app.get("/api/activity", wrap(async (_, res) => {
  const snaps = await latest(2);
  if (snaps.length < 2) return res.json({ note: "Need at least 2 snapshots." });
  res.json(diffActivity(snaps[1], snaps[0]));
}));

app.post("/api/chat", wrap(async (req, res) => {
  const { message, sessionId = "default" } = req.body;
  const { answer, steps } = await runAgent(message, sessionId); // agentic loop: plan -> tools -> check
  saveMessage(sessionId, "user", message).catch(() => {});
  saveMessage(sessionId, "assistant", answer).catch(() => {});
  res.json({ answer, steps });
}));

app.get("/api/sessions", wrap(async (_, res) => res.json(await listSessions())));
app.get("/api/sessions/:id", wrap(async (req, res) => res.json(await getSession(req.params.id))));

const port = process.env.PORT || 3000;
init()
  .catch((e) => console.warn("DB unavailable (snapshots disabled):", e.message))
  .finally(() => app.listen(port, () => console.log(`sunflower-ai on :${port}`)));
