/**
 * server/tests/sessions.test.ts
 * Concurrent Session Cap (1 desktop + 1 mobile), conflict resolution, and token rotation tests.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authService } from '../services/auth/AuthService.js';
import { SessionModel } from '../models/SessionModel.js';
import { pool } from '../db/database.js';

describe('Concurrent Session Management Suite (1 Desktop + 1 Mobile)', () => {
  let usersTable: any[] = [];
  let sessionsTable: any[] = [];
  let nextUserId = 1;
  let nextSessionId = 1;

  beforeEach(() => {
    usersTable = [];
    sessionsTable = [];
    nextUserId = 1;
    nextSessionId = 1;

    // Mock pool.query / db.query
    (pool as any).query = async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();

      // Users queries
      if (s.includes('FROM users WHERE username = $1 OR email = $1')) {
        const ident = params[0];
        const rows = usersTable.filter((u) => u.username === ident || u.email === ident);
        return { rows, rowCount: rows.length };
      }
      if (s.startsWith('INSERT INTO users')) {
        const [username, email, passwordHash, farmId, registrationIp, role, aiCredits] = params;
        const user = {
          id: nextUserId++,
          username,
          email,
          password_hash: passwordHash,
          farm_id: farmId,
          registration_ip: registrationIp,
          role: role || 'USER',
          ai_credits: aiCredits ?? 50,
          ai_credits_used: 0,
        };
        usersTable.push(user);
        return { rows: [user], rowCount: 1 };
      }
      if (s.startsWith('UPDATE users SET last_login')) {
        return { rows: [], rowCount: 1 };
      }

      // Active sessions queries
      if (s.includes('SELECT * FROM active_sessions WHERE user_id = $1 AND device_type = $2')) {
        const [userId, deviceType] = params;
        const rows = sessionsTable.filter((row) => row.user_id === userId && row.device_type === deviceType);
        return { rows, rowCount: rows.length };
      }

      if (s.startsWith('INSERT INTO active_sessions')) {
        const [userId, deviceType, tokenHash] = params;
        // Unique index enforcement: (user_id, device_type)
        const conflict = sessionsTable.some((row) => row.user_id === userId && row.device_type === deviceType);
        if (conflict) {
          const err: any = new Error('duplicate key value violates unique constraint "idx_one_session_per_device_type"');
          err.code = '23505';
          throw err;
        }
        const session = {
          id: nextSessionId++,
          user_id: userId,
          device_type: deviceType,
          refresh_token_hash: tokenHash,
          created_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
        };
        sessionsTable.push(session);
        return { rows: [session], rowCount: 1 };
      }

      if (s.startsWith('DELETE FROM active_sessions WHERE user_id = $1 AND device_type = $2')) {
        const [userId, deviceType] = params;
        const initialLen = sessionsTable.length;
        sessionsTable = sessionsTable.filter((row) => !(row.user_id === userId && row.device_type === deviceType));
        return { rows: [], rowCount: initialLen - sessionsTable.length };
      }

      if (s.includes('SELECT 1 FROM active_sessions WHERE user_id = $1 AND device_type = $2 AND refresh_token_hash = $3')) {
        const [userId, deviceType, tokenHash] = params;
        const match = sessionsTable.some(
          (row) => row.user_id === userId && row.device_type === deviceType && row.refresh_token_hash === tokenHash
        );
        return { rows: match ? [{ 1: 1 }] : [], rowCount: match ? 1 : 0 };
      }

      if (s.startsWith('UPDATE active_sessions SET last_active_at')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    };
  });

  it('Test 8: Login on desktop with no existing session succeeds and creates a session row', async () => {
    await authService.register({
      username: 'desktop_user',
      email: 'desktop@example.com',
      password: 'password123',
    });

    const loginRes = await authService.login('desktop_user', 'password123', 'desktop');
    assert.equal(loginRes.success, true);
    assert.ok(loginRes.accessToken);
    assert.ok(loginRes.refreshToken);

    const active = await SessionModel.findByUserAndDevice(loginRes.user!.id!, 'desktop');
    assert.ok(active);
    assert.equal(active.device_type, 'desktop');
  });

  it('Test 9: A second desktop login attempt while first session is active returns 409 SESSION_CONFLICT and does not overwrite', async () => {
    const reg = await authService.register({
      username: 'multi_desktop',
      email: 'multidesk@example.com',
      password: 'password123',
    });

    // Login 1 on desktop
    const login1 = await authService.login('multi_desktop', 'password123', 'desktop');
    assert.equal(login1.success, true);
    const initialSession = await SessionModel.findByUserAndDevice(reg.user!.id!, 'desktop');

    // Login 2 on desktop without forceDisconnect
    const login2 = await authService.login('multi_desktop', 'password123', 'desktop', false);
    assert.equal(login2.success, false);
    assert.equal(login2.conflict, true);
    assert.equal(login2.deviceType, 'desktop');
    assert.match(login2.error!, /already logged in on desktop/);

    // Verify session row was not modified
    const currentSession = await SessionModel.findByUserAndDevice(reg.user!.id!, 'desktop');
    assert.equal(currentSession?.refresh_token_hash, initialSession?.refresh_token_hash);
  });

  it('Test 10: Desktop and mobile logins for the same user succeed independently and coexist', async () => {
    const reg = await authService.register({
      username: 'coexist_user',
      email: 'coexist@example.com',
      password: 'password123',
    });
    const userId = reg.user!.id!;

    // Desktop login
    const deskRes = await authService.login('coexist_user', 'password123', 'desktop');
    assert.equal(deskRes.success, true);

    // Mobile login
    const mobRes = await authService.login('coexist_user', 'password123', 'mobile');
    assert.equal(mobRes.success, true);

    const deskSession = await SessionModel.findByUserAndDevice(userId, 'desktop');
    const mobSession = await SessionModel.findByUserAndDevice(userId, 'mobile');

    assert.ok(deskSession, 'Desktop session exists');
    assert.ok(mobSession, 'Mobile session exists');
    assert.equal(deskSession.device_type, 'desktop');
    assert.equal(mobSession.device_type, 'mobile');
  });

  it('Test 11: Login with forceDisconnect: true deletes the old session row, creates a new one, and old refresh token fails', async () => {
    await authService.register({
      username: 'force_user',
      email: 'force@example.com',
      password: 'password123',
    });

    // Session 1
    const s1 = await authService.login('force_user', 'password123', 'desktop');
    assert.equal(s1.success, true);
    const oldRefreshToken = s1.refreshToken!;

    // Session 2 with forceDisconnect = true
    const s2 = await authService.login('force_user', 'password123', 'desktop', true);
    assert.equal(s2.success, true);
    const newRefreshToken = s2.refreshToken!;

    // Old refresh token must fail validation
    const oldRefreshRes = await authService.refreshAccessToken(oldRefreshToken);
    assert.equal(oldRefreshRes.success, false);
    assert.equal(oldRefreshRes.error, 'Session disconnected. Please log in again.');

    // New refresh token must succeed
    const newRefreshRes = await authService.refreshAccessToken(newRefreshToken);
    assert.equal(newRefreshRes.success, true);
    assert.ok(newRefreshRes.accessToken);
  });

  it('Test 12: Two concurrent forced logins for the same device type — exactly one session row exists afterward', async () => {
    const reg = await authService.register({
      username: 'race_login_user',
      email: 'racelogin@example.com',
      password: 'password123',
    });
    const userId = reg.user!.id!;

    // Two concurrent logins attempting to claim the desktop slot
    const [loginA, loginB] = await Promise.all([
      SessionModel.create(userId, 'desktop', 'token-A-123'),
      SessionModel.create(userId, 'desktop', 'token-B-456'),
    ]);

    const created = [loginA, loginB].filter((res) => res !== null);
    const rejected = [loginA, loginB].filter((res) => res === null);

    assert.equal(created.length, 1, 'Exactly one concurrent session creation must succeed');
    assert.equal(rejected.length, 1, 'Exactly one concurrent session creation must hit the 23505 race net');

    const totalActive = sessionsTable.filter((r) => r.user_id === userId && r.device_type === 'desktop');
    assert.equal(totalActive.length, 1, 'Only one row can physically exist for (user, desktop)');
  });

  it('Test 13: An already-issued access token continues to verify until natural TTL, documenting the lag trade-off', () => {
    const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

    // Issue short-lived access token
    const token = jwt.sign({ userId: 101, username: 'lag_user' }, secret, { expiresIn: '15m' });
    const verified = jwt.verify(token, secret) as any;
    assert.equal(verified.username, 'lag_user');

    // Expired token fails
    const expiredToken = jwt.sign({ userId: 101, username: 'lag_user' }, secret, { expiresIn: '-1s' });
    assert.throws(() => jwt.verify(expiredToken, secret), /jwt expired/);
  });
});
