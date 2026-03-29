import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config.js';

// Simple session store (in-memory)
const sessions = new Map<string, { createdAt: number }>();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Brute force protection
interface LoginAttempt {
  count: number;
  firstAttempt: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, LoginAttempt>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes lockout after max attempts

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export function validatePassword(password: string): boolean {
  const config = getConfig();
  const correctPassword = config.visualization_password;
  if (!correctPassword) return false;
  return password === correctPassword;
}

// Brute force protection functions
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isLockedOut(ip: string): { locked: boolean; remainingMs: number } {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return { locked: false, remainingMs: 0 };

  const now = Date.now();

  // Check if locked out
  if (attempt.lockedUntil > now) {
    return { locked: true, remainingMs: attempt.lockedUntil - now };
  }

  // Check if window expired, reset if so
  if (now - attempt.firstAttempt > WINDOW_MS) {
    loginAttempts.delete(ip);
    return { locked: false, remainingMs: 0 };
  }

  return { locked: false, remainingMs: 0 };
}

export function recordFailedAttempt(ip: string): { locked: boolean; attemptsRemaining: number } {
  const now = Date.now();
  let attempt = loginAttempts.get(ip);

  if (!attempt || now - attempt.firstAttempt > WINDOW_MS) {
    // Start new window
    attempt = { count: 1, firstAttempt: now, lockedUntil: 0 };
    loginAttempts.set(ip, attempt);
    return { locked: false, attemptsRemaining: MAX_ATTEMPTS - 1 };
  }

  attempt.count++;

  if (attempt.count >= MAX_ATTEMPTS) {
    attempt.lockedUntil = now + LOCKOUT_MS;
    console.warn(`[Auth] IP ${ip} locked out for ${LOCKOUT_MS / 60000} minutes after ${MAX_ATTEMPTS} failed attempts`);
    return { locked: true, attemptsRemaining: 0 };
  }

  return { locked: false, attemptsRemaining: MAX_ATTEMPTS - attempt.count };
}

export function clearFailedAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

export function createSession(): string {
  const token = generateSessionToken();
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false;

  const session = sessions.get(token);
  if (!session) return false;

  // Check expiration
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }

  return true;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

// Cleanup expired sessions and login attempts periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(token);
    }
  }
  // Cleanup old login attempts
  for (const [ip, attempt] of loginAttempts) {
    if (now - attempt.firstAttempt > WINDOW_MS && attempt.lockedUntil < now) {
      loginAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000); // Every hour

// Express middleware
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for login page and static assets
  if (req.path === '/login' || req.path === '/api/login' || req.path.startsWith('/static/')) {
    next();
    return;
  }

  const token = req.cookies?.['viz_session'];

  if (validateSession(token)) {
    next();
  } else {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Unauthorized' });
    } else {
      res.redirect('/login');
    }
  }
}

// WebSocket authentication
export function validateWsAuth(token: string | undefined): boolean {
  return validateSession(token);
}
