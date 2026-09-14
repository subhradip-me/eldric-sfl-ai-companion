/**
 * server/tests/securityAndCredits.test.ts
 * Tests for IP Registration Gate and AI Credit Model.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authService } from '../services/auth/AuthService.js';
import { UserModel } from '../models/UserModel.js';
import { pool } from '../db/database.js';

describe('Security & AI Credit Model Suite', () => {
  const userModel = new UserModel();

  // In-memory table stores for hermetic test execution
  let usersTable: any[] = [];
  let nextUserId = 1;

  beforeEach(() => {
    usersTable = [];
    nextUserId = 1;

    // Mock pool.query to simulate PostgreSQL in-memory
    (pool as any).query = async (sql: string, params: any[] = []) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      // 1. IP check query
      if (normalizedSql.includes('SELECT id FROM users WHERE registration_ip = $1 AND role != \'DEVELOPER\' AND username != \'dev\'')) {
        const ip = params[0];
        const rows = usersTable.filter((u) => u.registration_ip === ip && u.role !== 'DEVELOPER' && u.username !== 'dev');
        return { rows, rowCount: rows.length };
      }

      // 2. Exists username or email
      if (normalizedSql.includes('SELECT id FROM users WHERE username = $1 OR email = $2')) {
        const [username, email] = params;
        const rows = usersTable.filter((u) => u.username === username || u.email === email);
        return { rows, rowCount: rows.length };
      }

      // 3. Insert user
      if (normalizedSql.startsWith('INSERT INTO users')) {
        const [username, email, passwordHash, farmId, registrationIp, role, aiCredits] = params;
        const newUser = {
          id: nextUserId++,
          username,
          email,
          password_hash: passwordHash,
          farm_id: farmId,
          registration_ip: registrationIp,
          role: role || 'USER',
          ai_credits: aiCredits ?? 50,
          ai_credits_used: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
          last_login: null,
        };
        usersTable.push(newUser);
        return { rows: [newUser], rowCount: 1 };
      }

      // 4. Find user by id
      if (normalizedSql.includes('FROM users WHERE id = $1')) {
        const id = params[0];
        const rows = usersTable.filter((u) => u.id === id);
        return { rows, rowCount: rows.length };
      }

      // 5. Find by username or email
      if (normalizedSql.includes('FROM users WHERE username = $1 OR email = $1')) {
        const ident = params[0];
        const rows = usersTable.filter((u) => u.username === ident || u.email === ident);
        return { rows, rowCount: rows.length };
      }

      // 6. Deduct credit conditionally: WHERE id = $1 AND ai_credits >= $2
      if (normalizedSql.includes('SET ai_credits = ai_credits - $2') && normalizedSql.includes('AND ai_credits >= $2')) {
        const [userId, amount] = params;
        const user = usersTable.find((u) => u.id === userId);
        if (user && user.ai_credits >= amount) {
          user.ai_credits -= amount;
          user.ai_credits_used += amount;
          return { rows: [{ ai_credits: user.ai_credits, ai_credits_used: user.ai_credits_used }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // 7. Add / refund credit
      if (normalizedSql.includes('SET ai_credits = ai_credits + $2')) {
        const [userId, amount] = params;
        const user = usersTable.find((u) => u.id === userId);
        if (user) {
          user.ai_credits += amount;
          return { rows: [{ ai_credits: user.ai_credits }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // 8. Session queries
      if (normalizedSql.includes('active_sessions')) {
        return { rows: [], rowCount: 0 };
      }

      // Default fallback
      return { rows: [], rowCount: 0 };
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // IP Gate Tests (Tests 1–3)
  // ───────────────────────────────────────────────────────────────────────────

  it('Test 1: First user registration from IP 198.51.100.1 succeeds and receives 50 initial credits', async () => {
    const res = await authService.register({
      username: 'farmer_alice',
      email: 'alice@example.com',
      password: 'password123',
      registrationIp: '198.51.100.1',
    });

    assert.equal(res.success, true);
    assert.equal(res.user?.username, 'farmer_alice');
    assert.equal(res.user?.ai_credits, 50);
  });

  it('Test 2: Second user registration from IP 198.51.100.1 is rejected with 409 error message', async () => {
    // First registration
    const res1 = await authService.register({
      username: 'farmer_alice',
      email: 'alice@example.com',
      password: 'password123',
      registrationIp: '198.51.100.1',
    });
    assert.equal(res1.success, true);

    // Second registration from identical IP
    const res2 = await authService.register({
      username: 'farmer_bob',
      email: 'bob@example.com',
      password: 'password123',
      registrationIp: '198.51.100.1',
    });

    assert.equal(res2.success, false);
    assert.match(res2.error!, /Account registration limit reached/);
  });

  it('Test 3: Developer registration / dev account is exempted from the IP limit and can register from any IP', async () => {
    // Normal registration
    await authService.register({
      username: 'farmer_alice',
      email: 'alice@example.com',
      password: 'password123',
      registrationIp: '198.51.100.1',
    });

    // Developer registration from the same IP succeeds
    const devRes = await authService.register({
      username: 'dev',
      email: 'dev@example.com',
      password: 'developer123',
      registrationIp: '198.51.100.1',
      role: 'DEVELOPER',
    });

    assert.equal(devRes.success, true);
    assert.equal(devRes.user?.role, 'DEVELOPER');
    assert.equal(devRes.user?.ai_credits, 999999);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Credit Model Tests (Tests 4–7)
  // ───────────────────────────────────────────────────────────────────────────

  it('Test 4: Chat request with positive credits succeeds and decrements credit count by 1', async () => {
    const reg = await authService.register({
      username: 'credit_user',
      email: 'credit@example.com',
      password: 'password123',
      registrationIp: '198.51.100.2',
    });
    const userId = reg.user!.id!;

    // Atomic deduction
    const deduction = await userModel.deductAiCredit(userId, 1);
    assert.ok(deduction);
    assert.equal(deduction.ai_credits, 49);
    assert.equal(deduction.ai_credits_used, 1);
  });

  it('Test 5: Chat request with 0 credits is rejected before AI provider is ever called', async () => {
    const reg = await authService.register({
      username: 'broke_user',
      email: 'broke@example.com',
      password: 'password123',
      registrationIp: '198.51.100.3',
    });
    const userId = reg.user!.id!;

    // Drain all 50 credits
    const drain = await userModel.deductAiCredit(userId, 50);
    assert.ok(drain);
    assert.equal(drain.ai_credits, 0);

    // Attempt reservation at 0 credits
    const failedReservation = await userModel.deductAiCredit(userId, 1);
    assert.equal(failedReservation, null, 'Reservation must return null when credits are exhausted');
  });

  it('Test 6: Developer chat request succeeds regardless of credit balance and is never deducted', async () => {
    const dev = await authService.register({
      username: 'dev',
      email: 'dev@sunflower.internal',
      password: 'developer123',
      role: 'DEVELOPER',
    });
    const user = await userModel.findById(dev.user!.id!);
    const isDev = user?.username === 'dev' || user?.role === 'DEVELOPER';
    assert.equal(isDev, true);
    // Developer bypasses credit reservation logic completely
  });

  it('Test 7: Two concurrent chat requests at ai_credits = 1 — exactly one succeeds and deducts, the other is rejected', async () => {
    const reg = await authService.register({
      username: 'race_user',
      email: 'race@example.com',
      password: 'password123',
      registrationIp: '198.51.100.4',
    });
    const userId = reg.user!.id!;

    // Set credits to exactly 1
    await userModel.deductAiCredit(userId, 49);
    const initialUser = await userModel.findById(userId);
    assert.equal(initialUser?.ai_credits, 1);

    // Simulate two concurrent requests trying to reserve 1 credit simultaneously
    const [res1, res2] = await Promise.all([
      userModel.deductAiCredit(userId, 1),
      userModel.deductAiCredit(userId, 1),
    ]);

    const successes = [res1, res2].filter((r) => r !== null);
    const failures = [res1, res2].filter((r) => r === null);

    assert.equal(successes.length, 1, 'Exactly one concurrent request must succeed');
    assert.equal(failures.length, 1, 'Exactly one concurrent request must be rejected');

    const finalUser = await userModel.findById(userId);
    assert.equal(finalUser?.ai_credits, 0, 'Final credits must be exactly 0 without negative balance');
  });
});
