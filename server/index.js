import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { init } from "./db/database.js";
import { getFarm, getPrices } from "./services/sunflower.js";
import { plan } from "./services/planner.js";
import { diffActivity } from "./services/activity.js";
import { save, latest } from "./services/snapshots.js";
import { runAgent } from "./services/orchestrator.js";
import { saveMessage, listSessions, getSession } from "./services/chatStore.js";
import { authService, authenticateToken, optionalAuth } from "./services/auth.js";
import recipes from "./data/recipes.json" with { type: "json" };
import items from "./data/items.json" with { type: "json" };
import modifiers from "./data/modifiers.json" with { type: "json" };

const app = express();
app.use(cors({ origin: true, credentials: true }), express.json(), cookieParser());
const L100 = 24083905;

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => res.status(502).json({ error: String(e.message ?? e) }));

app.get("/api/health", (_, res) => res.json({ ok: true }));

// ========== AUTH ROUTES ==========
app.post("/api/auth/register", wrap(async (req, res) => {
  const { username, email, password, farmId } = req.body;
  const result = await authService.register({ username, email, password, farmId });
  
  if (result.success) {
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const { username, password } = req.body;
  const result = await authService.login({ username, password });
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(401).json(result);
  }
}));

app.get("/api/auth/me", authenticateToken, wrap(async (req, res) => {
  const result = await authService.getUserById(req.userId);
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
}));

app.put("/api/auth/farm", authenticateToken, wrap(async (req, res) => {
  const { farmId } = req.body;
  const result = await authService.updateFarmId(req.userId, farmId);
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
}));

app.put("/api/auth/password", authenticateToken, wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const result = await authService.changePassword(req.userId, oldPassword, newPassword);
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
}));

// ========== PROTECTED ROUTES ==========

// ========== PROTECTED ROUTES ==========

app.get("/api/farm", optionalAuth, wrap(async (req, res) => {
  const { canonical, stale } = await getFarm(req.userId);
  await save(canonical, req.userId).catch(() => {}); // DB optional in dev
  res.json({ ...canonical, stale, target: { level: 100, xp: L100, remaining: Math.max(L100 - canonical.bumpkin.xp, 0) } });
}));

app.get("/api/market", wrap(async (_, res) => {
  const { prices, updatedAt, stale } = await getPrices();
  res.json({ prices, items, updatedAt, stale });
}));

app.get("/api/planner", optionalAuth, wrap(async (req, res) => {
  const [{ canonical }, { prices }] = await Promise.all([getFarm(req.userId), getPrices()]);
  res.json(plan(canonical, prices, recipes, items, modifiers));
}));

app.get("/api/activity", optionalAuth, wrap(async (req, res) => {
  const snaps = await latest(2, req.userId);
  if (snaps.length < 2) return res.json({ note: "Need at least 2 snapshots." });
  res.json(diffActivity(snaps[1], snaps[0]));
}));

app.post("/api/chat", optionalAuth, wrap(async (req, res) => {
  const { message, sessionId = "default" } = req.body;
  const { answer, steps } = await runAgent(message, sessionId, req.userId); // agentic loop: plan -> tools -> check
  saveMessage(sessionId, "user", message, req.userId).catch(() => {});
  saveMessage(sessionId, "assistant", answer, req.userId).catch(() => {});
  res.json({ answer, steps });
}));

app.get("/api/sessions", optionalAuth, wrap(async (req, res) => res.json(await listSessions(req.userId))));
app.get("/api/sessions/:id", optionalAuth, wrap(async (req, res) => res.json(await getSession(req.params.id, req.userId))));

const port = process.env.PORT || 3000;
init()
  .catch((e) => console.warn("DB unavailable (snapshots disabled):", e.message))
  .finally(() => app.listen(port, () => console.log(`sunflower-ai on :${port}`)));
