/**
 * server/domain/user.ts
 * User domain entity representing a player account.
 * Note: Users have a 1:N relational ownership with Farms (farm.userId).
 */

import type { UserId, TimestampMs } from './types.js';

export interface User {
  userId: UserId;
  username: string;
  email?: string;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
  lastLoginAt?: TimestampMs | null;
}
