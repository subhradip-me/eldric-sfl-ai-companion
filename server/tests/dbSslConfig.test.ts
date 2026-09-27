/**
 * server/tests/dbSslConfig.test.ts
 * resolvePgSsl — the single decision that lets one DATABASE_URL work across
 * local docker-compose, Render Internal (private network, plain TCP) and
 * Render External (public endpoint, self-signed TLS) with no code change.
 *
 * Root cause this guards: on Render the app logged
 *   `DB not ready: connect ECONNREFUSED 127.0.0.1:5432`
 * because DATABASE_URL pointed at localhost. Once it points at the real
 * database, the *next* foot-gun is SSL — an Internal URL must NOT use TLS,
 * an External one MUST — so this function encodes both so neither bites again.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePgSsl } from '../db/database.js';

describe('resolvePgSsl — auto-detection', () => {
  it('disables SSL for local / docker-compose URLs', () => {
    assert.equal(resolvePgSsl('postgres://sfl:sfl@localhost:5432/sunflower'), false);
    assert.equal(resolvePgSsl('postgres://sfl:sfl@db:5432/sunflower'), false);
  });

  it('disables SSL for a Render Internal URL (private network, plain TCP)', () => {
    // Internal hostnames look like `dpg-xxxx-a` with no .render.com suffix.
    assert.equal(resolvePgSsl('postgres://user:pw@dpg-abc123-a/sunflower'), false);
  });

  it('enables relaxed-cert SSL for a Render External URL', () => {
    assert.deepEqual(
      resolvePgSsl('postgres://user:pw@dpg-abc123-a.oregon-postgres.render.com/sunflower'),
      { rejectUnauthorized: false },
    );
  });

  it('enables SSL when the URL carries sslmode=require', () => {
    assert.deepEqual(
      resolvePgSsl('postgres://user:pw@somehost/db?sslmode=require'),
      { rejectUnauthorized: false },
    );
  });
});

describe('resolvePgSsl — explicit override wins', () => {
  it('DATABASE_SSL=false forces plain TCP even on an external URL', () => {
    assert.equal(
      resolvePgSsl('postgres://user:pw@dpg-abc123-a.oregon-postgres.render.com/db', 'false'),
      false,
    );
  });

  it('DATABASE_SSL=true forces TLS even on a localhost URL', () => {
    assert.deepEqual(
      resolvePgSsl('postgres://sfl:sfl@localhost:5432/sunflower', 'true'),
      { rejectUnauthorized: false },
    );
  });
});
