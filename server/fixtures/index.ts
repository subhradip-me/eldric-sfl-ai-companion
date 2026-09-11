/**
 * server/fixtures/index.ts
 * Typed loader and registry for test fixtures.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type FixtureName =
  | 'farm-high-level-spooky'
  | 'farm-low-level'
  | 'farm-mid-level'
  | 'farm-near-level-100'
  | 'farm-reservation-conflict'
  | 'farm-multi-objective-conflict'
  | 'farm-active-production'
  | 'farm-season-boundary'
  | 'farm-deadline-pressure'
  | 'farm-full-buffs'
  | 'farm-market-dependent';

/**
 * Synchronously load a JSON fixture by name.
 */
export function loadFixture<T = Record<string, unknown>>(name: FixtureName): T {
  const filePath = path.join(__dirname, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}
