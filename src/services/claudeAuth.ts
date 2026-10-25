import { execSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

export interface AuthStatus {
  loggedIn: boolean;
  authMethod: string;
  apiProvider: string;
}

export interface LoginSession {
  url: string;
  /** Exchange the authorization code for OAuth tokens. Returns null on success, error message on failure. */
  submitCode: (code: string) => Promise<string | null>;
  /** Cancel the login */
  cancel: () => void;
}

const OAUTH_CONFIG = {
  CLIENT_ID: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  AUTHORIZE_URL: "https://claude.ai/oauth/authorize",
  TOKEN_URL: "https://platform.claude.com/v1/oauth/token",
  PROFILE_URL: "https://api.anthropic.com/api/oauth/profile",
  REDIRECT_URI: "https://platform.claude.com/oauth/code/callback",
  SCOPES: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers",
};

const CONFIG_PATH = resolve(homedir(), ".claude.json");
const CLAUDE_DIR = resolve(homedir(), ".claude");
const CREDENTIALS_PATH = join(CLAUDE_DIR, ".credentials.json");

// ---------- API 키 풀 (2026-10-21) ----------
// .env ANTHROPIC_API_KEYS=새키,기존키 (쉼표 구분, 앞이 우선). 없으면 ANTHROPIC_API_KEY 하나.
// 앞 키가 한도 소진·크레딧 부족·인증 오류를 내면 그 키를 잠시 쉬게 하고 다음 키로 이어서 처리한다.
// 쉬는 시간이 끝나면 다시 앞 키부터 쓴다 — 새 키가 충전되면 저절로 돌아온다.
const KEY_REST_MS = 60 * 60_000;
const RATE_LIMIT_REST_MS = 15 * 60_000;
const KEY_ERRORS = new Set(["authentication_failed", "billing_error", "rate_limit"]);
const QUOTA_TEXT = /credit balance|billing|usage limit|spend limit|quota|regain access|rate limit/i;
let apiKeys: string[] = [];
const keyRestUntil = new Map<string, number>();

/** .env 에서 키 목록을 읽는다. 첫 키를 ANTHROPIC_API_KEY 로도 둬서 기존 동작(isAuthenticated 등)을 유지한다. */
export function loadApiKeys(): string[] {
  const raw = process.env.ANTHROPIC_API_KEYS || process.env.ANTHROPIC_API_KEY || "";
  apiKeys = [...new Set(raw.split(/[\s,]+/).map((k) => k.trim().replace(/^["']|["']$/g, "")).filter(Boolean))];
  delete process.env.ANTHROPIC_API_KEYS;
  if (apiKeys.length > 0) process.env.ANTHROPIC_API_KEY = apiKeys[0];
  return apiKeys;
}

export function apiKeyCount(): number {
  return apiKeys.length;
}

// ---------- 키를 다 쓰면 이 기기에 로그인된 Claude Code 구독으로 (2026-10-26) ----------
// 쓸 수 있는 키가 하나도 없고 CLI 가 구독으로 로그인돼 있으면 키 없이 실행한다. CLI 가 자기 로그인을
// 쓰고 갱신도 직접 한다 — 터미널에서 여는 Claude Code 세션 하나가 더 붙는 것과 같다.
// 쉬는 키는 시간이 지나도 바로 쓰지 않는다. 1토큰 요청으로 잔액을 확인하고 통과해야 다시 쓴다
// (안 그러면 충전 안 된 키로 대화를 시작했다가 실패하고 전환하는 일이 한 시간마다 생긴다).
export type Credential = { kind: "apiKey"; key: string } | { kind: "subscription" };

const PROBE_MODEL = "claude-haiku-4-5";
const MONITOR_INTERVAL_MS = 10 * 60_000;
let subscriptionReady = false;
let subscriptionChecked = false;
let monitorTimer: ReturnType<typeof setInterval> | null = null;

function readyKeys(): string[] {
  return apiKeys.filter((k) => !keyRestUntil.has(k));
}

/** 쓸 인증 수단. 쉬지 않는 키 → (전부 막혔으면) 구독 로그인 → (그것도 없으면) 가장 빨리 풀리는 키. */
export function pickCredential(): Credential | null {
  if (apiKeys.length === 0) return null;
  const ready = readyKeys()[0];
  if (ready) return { kind: "apiKey", key: ready };
  if (subscriptionReady) return { kind: "subscription" };
  return { kind: "apiKey", key: [...apiKeys].sort((a, b) => keyRestUntil.get(a)! - keyRestUntil.get(b)!)[0] };
}

export function apiKeyEnv(key: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ANTHROPIC_API_KEY: key };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.CLAUDE_SUBSCRIPTION_TOKEN;
  return env;
}

/**
 * 구독 로그인으로 실행할 env — 키·토큰·프록시 주소를 빼서 CLI 가 자기 로그인을 쓰게 한다.
 * .env 에 CLAUDE_SUBSCRIPTION_TOKEN(`claude setup-token` 으로 받은 장수명 구독 토큰)이 있으면 그걸 쓴다.
 * pm2 데몬이 GUI 세션 밖(SSH 등)에서 떠 있으면 키체인에 든 로그인을 못 읽어서, 그런 기기는 이 토큰이 필요하다.
 */
function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEYS", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_SUBSCRIPTION_TOKEN"]) delete env[k];
  const token = process.env.CLAUDE_SUBSCRIPTION_TOKEN?.trim();
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

export function credentialEnv(c: Credential | null): Record<string, string | undefined> | undefined {
  if (!c) return undefined;
  return c.kind === "apiKey" ? apiKeyEnv(c.key) : subscriptionEnv();
}

export function credentialLabel(c: Credential | null): string {
  if (!c) return "none";
  return c.kind === "apiKey" ? `API key …${c.key.slice(-6)}` : "Claude Code subscription login";
}

/** 키 하나를 1토큰 요청으로 확인한다. 비용은 사실상 0. */
export async function probeApiKey(key: string): Promise<"ok" | "depleted" | "rate_limited" | "unknown"> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: PROBE_MODEL, max_tokens: 1, messages: [{ role: "user", content: "." }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return "ok";
    const text = await res.text().catch(() => "");
    if (res.status === 429) return "rate_limited";
    if (isApiKeyProblem(undefined, res.status, text)) return "depleted";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** CLI 가 이 기기에서 구독(claude.ai)으로 로그인돼 있는가. 키 env 를 뺀 채로 `claude auth status` 를 본다. */
export async function checkSubscriptionLogin(): Promise<boolean> {
  const bin = process.env.CLAUDE_CODE_PATH;
  if (!bin) {
    subscriptionReady = false;
    return false;
  }
  const { execFile } = await import("node:child_process");
  const out = await new Promise<string>((resolveOut) => {
    execFile(bin, ["auth", "status"], { env: subscriptionEnv() as NodeJS.ProcessEnv, timeout: 20_000 }, (_err, stdout) => resolveOut(String(stdout ?? "")));
  });
  let ok = false;
  try {
    const s = JSON.parse(out);
    const usingToken = !!process.env.CLAUDE_SUBSCRIPTION_TOKEN?.trim();
    ok = s.loggedIn === true && (usingToken ? s.authMethod === "oauth_token" : s.authMethod === "claude.ai");
    if (ok !== subscriptionReady || !subscriptionChecked) console.log(`[auth] Subscription login ${ok ? `available (${usingToken ? "CLAUDE_SUBSCRIPTION_TOKEN" : `${s.email ?? "?"}, ${s.subscriptionType ?? "?"}`})` : `NOT available (authMethod=${s.authMethod}${usingToken ? "" : " — set CLAUDE_SUBSCRIPTION_TOKEN from \`claude setup-token\` if the CLI login lives in a keychain this process can't read"})`}`);
  } catch {
    if (subscriptionReady) console.warn("[auth] Subscription login check failed — treating as unavailable");
  }
  subscriptionReady = ok;
  subscriptionChecked = true;
  return ok;
}

async function probeAndRest(key: string): Promise<void> {
  const r = await probeApiKey(key);
  if (r === "ok") {
    markApiKeyOk(key);
  } else if (r === "depleted") {
    keyRestUntil.set(key, Date.now() + KEY_REST_MS);
  } else if (r === "rate_limited") {
    keyRestUntil.set(key, Date.now() + RATE_LIMIT_REST_MS);
  } else if (!keyRestUntil.has(key)) {
    // 네트워크 문제 등 판단 불가 — 쉬던 키가 아니면 그대로 둔다
  } else {
    keyRestUntil.set(key, Date.now() + RATE_LIMIT_REST_MS);
  }
}

/** 시작 시 전체 키·구독 로그인 확인, 이후 10분마다 쉬는 시간이 끝난 키만 다시 확인. */
export async function startApiKeyMonitor(): Promise<void> {
  if (monitorTimer || apiKeys.length === 0) return;
  await Promise.all([checkSubscriptionLogin(), ...apiKeys.map((k) => probeAndRest(k))]);
  const usable = readyKeys().length;
  console.log(`[auth] Key check: ${usable}/${apiKeys.length} key(s) usable — now using ${credentialLabel(pickCredential())}`);
  monitorTimer = setInterval(async () => {
    const now = Date.now();
    const due = apiKeys.filter((k) => (keyRestUntil.get(k) ?? Infinity) <= now);
    if (due.length === 0 && readyKeys().length > 0) return;
    const before = credentialLabel(pickCredential());
    await Promise.all([checkSubscriptionLogin(), ...due.map((k) => probeAndRest(k))]);
    const after = credentialLabel(pickCredential());
    if (after !== before) console.log(`[auth] Credential switched: ${before} → ${after}`);
  }, MONITOR_INTERVAL_MS);
}

export function stopApiKeyMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

/** 이 오류가 키 자체 문제(한도·크레딧·인증)인가. 요청 내용 오류나 서버 과부하는 아니다. */
export function isApiKeyProblem(errorKind?: string, status?: number, text?: string): boolean {
  if (errorKind && KEY_ERRORS.has(errorKind)) return true;
  if (status !== undefined && [401, 402, 403, 429].includes(status)) return true;
  return status === 400 && QUOTA_TEXT.test(text ?? "");
}

/** SDK 가 던진 오류 문구로 키 문제를 판별한다 ("Claude Code returned an error result: ..."). */
export function isApiKeyProblemText(text: string): boolean {
  return /Invalid API key|credit balance|billing|usage limit|spend limit|quota|regain access|rate limit|API Error: (401|402|403|429)/i.test(text);
}

/** 키를 쉬게 한다. 다른 키나 구독 로그인으로 넘어갈 수 있으면 true. */
export function markApiKeyResting(key: string, status?: number, detail = ""): boolean {
  const ms = status === 429 || /rate limit/i.test(detail) ? RATE_LIMIT_REST_MS : KEY_REST_MS;
  keyRestUntil.set(key, Date.now() + ms);
  const next = pickCredential();
  const canSwitch = next !== null && !(next.kind === "apiKey" && next.key === key);
  console.warn(`[auth] API key …${key.slice(-6)} ${status ?? ""} (${detail.slice(0, 120)}) — resting ${Math.round(ms / 60_000)}m${canSwitch ? `, switching to ${credentialLabel(next)}` : ", nothing else to use"}`);
  return canSwitch;
}

export function markApiKeyOk(key: string): void {
  if (keyRestUntil.delete(key)) console.log(`[auth] API key …${key.slice(-6)} usable again`);
}

/**
 * Check if Claude Code is authenticated.
 * Checks credentials file directly for token validity.
 */
export function isAuthenticated(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  try {
    if (existsSync(CREDENTIALS_PATH)) {
      const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
      const oauth = creds.claudeAiOauth;
      if (oauth?.accessToken && oauth?.expiresAt) {
        const bufferMs = 5 * 60 * 1000;
        if (Date.now() < oauth.expiresAt - bufferMs) {
          return true;
        }
        console.log("[claudeAuth] Token expired, will need re-login");
        return false;
      }
    }
  } catch { /* ignore */ }
  return false;
}

// In-process mutex: the bot must be the sole refresher. The spawned claude
// cli.js refreshes only at the 5-minute expiry boundary; we keep the on-disk
// token far fresher than that, so the only refresher is this process. The
// mutex guarantees we never double-fire even if the timer and a manual call
// overlap.
let refreshInFlight: Promise<boolean> | null = null;

// Minimum remaining validity (ms) below which we still consider a freshly-read
// on-disk token "stale enough" to bother refreshing. Anything fresher than this
// means another writer already refreshed and we can skip.
const SKIP_IF_FRESHER_THAN_MS = 2 * 60 * 60 * 1000; // 2h

/**
 * Attempt to refresh the OAuth token using the refresh token.
 * Returns true if refresh succeeded (or the on-disk token is already fresh),
 * false otherwise. Serialized via an in-process mutex.
 */
export async function refreshToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefreshToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefreshToken(): Promise<boolean> {
  try {
    if (!existsSync(CREDENTIALS_PATH)) return false;

    const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
    const oauth = creds.claudeAiOauth;
    if (!oauth?.refreshToken) {
      console.log("[claudeAuth] No refresh token available");
      return false;
    }

    // Skip if another writer (interactive claude, a prior cycle) already left a
    // fresh token on disk. Avoids needlessly rotating the single-use refresh
    // token and racing with whoever just wrote it.
    if (oauth.expiresAt && oauth.expiresAt - Date.now() > SKIP_IF_FRESHER_THAN_MS) {
      return true;
    }

    console.log("[claudeAuth] Attempting token refresh...");
    const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        client_id: OAUTH_CONFIG.CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[claudeAuth] Token refresh failed:", response.status, errText);
      return false;
    }

    const tokenData = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    // Update credentials with new tokens
    oauth.accessToken = tokenData.access_token;
    if (tokenData.refresh_token) {
      oauth.refreshToken = tokenData.refresh_token;
    }
    oauth.expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : Date.now() + 24 * 60 * 60 * 1000;

    if (tokenData.scope) {
      oauth.scopes = tokenData.scope.split(" ");
    }

    writeJsonFile(CREDENTIALS_PATH, creds, 0o600);
    console.log("[claudeAuth] Token refreshed successfully, new expiry:", new Date(oauth.expiresAt).toISOString());
    return true;
  } catch (err) {
    console.error("[claudeAuth] Token refresh error:", err);
    return false;
  }
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a background timer that auto-refreshes the OAuth token before expiry.
 * Checks every 30 minutes and refreshes when <1 hour remains.
 */
export function startTokenAutoRefresh(): void {
  if (refreshTimer) return;

  // The spawned claude cli.js refreshes only when <5 min (300s) of validity
  // remain. We keep the on-disk token far fresher so those many concurrent
  // child processes NEVER reach their refresh boundary — making this process
  // the single refresher and eliminating the rotating-refresh-token race that
  // produced 401 "Invalid authentication credentials" storms.
  const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const REFRESH_THRESHOLD_MS = 2 * 60 * 60 * 1000; // refresh when <2 hours left (>> 5 min child threshold)

  const checkAndRefresh = async () => {
    try {
      if (!existsSync(CREDENTIALS_PATH)) return;

      const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
      const oauth = creds.claudeAiOauth;
      if (!oauth?.expiresAt) return;

      const timeLeft = oauth.expiresAt - Date.now();
      if (timeLeft > REFRESH_THRESHOLD_MS) {
        return; // Still plenty of time
      }

      if (timeLeft > 0) {
        console.log(`[claudeAuth] Token expires in ${Math.round(timeLeft / 60000)}m, refreshing proactively...`);
      } else {
        console.log("[claudeAuth] Token already expired, attempting refresh...");
      }

      const success = await refreshToken();
      if (!success) {
        console.warn("[claudeAuth] Auto-refresh failed. User will need to re-login via Discord.");
      }
    } catch (err) {
      console.error("[claudeAuth] Auto-refresh check error:", err);
    }
  };

  // Delay the first check briefly. On a pm2 restart the OUTGOING process is
  // still gracefully closing its sessions with the current (pre-rotation)
  // token; if we refresh immediately we rotate the refresh token out from
  // under it and it 401s on cleanup. A short delay lets it finish first.
  const STARTUP_DELAY_MS = 12 * 1000;
  setTimeout(checkAndRefresh, STARTUP_DELAY_MS);
  refreshTimer = setInterval(checkAndRefresh, CHECK_INTERVAL_MS);
  console.log("[claudeAuth] Token auto-refresh started (5 min interval, refresh at <2h remaining)");
}

/**
 * Stop the auto-refresh timer.
 */
export function stopTokenAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Bot-private OAuth token manager (isolated from the shared credential file).
//
// Why: the bot and any interactive Claude Code session share
// ~/.claude/.credentials.json. OAuth refresh tokens are single-use, so whenever
// one side refreshes it rotates the token and can invalidate the other side →
// 401 "Invalid authentication credentials".
//
// Fix: the bot keeps its OWN credential copy (~/.claude-discord/oauth.json),
// refreshes only that, and injects the current access token into every spawned
// claude cli.js via CLAUDE_CODE_OAUTH_TOKEN. When that env var is set the
// runtime authenticates straight from it and NEVER reads/writes/refreshes the
// shared file. So: single writer (no internal storm) + isolated file (no
// collision with interactive sessions). The bot becomes the sole owner of its
// own refresh-token lineage.
// ───────────────────────────────────────────────────────────────────────────

interface BotOAuthCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

const BOT_AUTH_DIR = resolve(homedir(), ".claude-discord");
const BOT_CREDENTIALS_PATH = join(BOT_AUTH_DIR, "oauth.json");

function readBotCreds(): BotOAuthCreds | null {
  try {
    if (existsSync(BOT_CREDENTIALS_PATH)) {
      return JSON.parse(readFileSync(BOT_CREDENTIALS_PATH, "utf-8")) as BotOAuthCreds;
    }
  } catch { /* ignore */ }
  return null;
}

function writeBotCreds(c: BotOAuthCreds): void {
  if (!existsSync(BOT_AUTH_DIR)) mkdirSync(BOT_AUTH_DIR, { recursive: true });
  const tmp = `${BOT_CREDENTIALS_PATH}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(c, null, 2));
  chmodSync(tmp, 0o600);
  renameSync(tmp, BOT_CREDENTIALS_PATH);
}

/** Copy the shared file's current OAuth creds into the bot-private store.
 *  `force` overwrites even if bot creds already exist (used for recovery when
 *  the bot's refresh token was consumed by another consumer). Copy only — does
 *  NOT refresh, so the shared refresh token is not consumed here. */
function seedBotCredsFromShared(force = false): boolean {
  if (!force && readBotCreds()?.refreshToken) return true;
  try {
    if (!existsSync(CREDENTIALS_PATH)) return false;
    const shared = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8")).claudeAiOauth;
    if (!shared?.accessToken || !shared?.refreshToken) return false;
    writeBotCreds({
      accessToken: shared.accessToken,
      refreshToken: shared.refreshToken,
      expiresAt: shared.expiresAt ?? Date.now() + 8 * 60 * 60 * 1000,
      scopes: shared.scopes,
      subscriptionType: shared.subscriptionType ?? null,
      rateLimitTier: shared.rateLimitTier ?? null,
    });
    console.log(`[botAuth] ${force ? "Re-seeded" : "Seeded"} bot-private credentials from shared file (copy, no rotation).`);
    return true;
  } catch (err) {
    console.error("[botAuth] Seed failed:", err);
    return false;
  }
}

/** Point spawned cli.js at the bot-private token. */
function applyBotTokenToEnv(): boolean {
  const c = readBotCreds();
  if (!c?.accessToken) return false;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = c.accessToken;
  return true;
}

let botRefreshInFlight: Promise<boolean> | null = null;

/** Refresh the BOT-PRIVATE token (rotates only the bot's own refresh-token
 *  lineage; never touches the shared file). Updates the injected env token. */
export async function refreshBotToken(): Promise<boolean> {
  if (botRefreshInFlight) return botRefreshInFlight;
  botRefreshInFlight = (async () => {
    const c = readBotCreds();
    if (!c?.refreshToken) return false;
    try {
      const resp = await fetch(OAUTH_CONFIG.TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: c.refreshToken,
          client_id: OAUTH_CONFIG.CLIENT_ID,
        }),
      });
      if (!resp.ok) {
        // Our refresh token was likely already rotated by another consumer of
        // the shared lineage. Recover by re-copying the shared file's current
        // (valid) token instead of dying.
        console.error("[botAuth] Refresh failed:", resp.status, await resp.text());
        const recovered = seedBotCredsFromShared(true);
        const rc = recovered ? readBotCreds() : null;
        if (rc && rc.expiresAt - Date.now() > 0) {
          process.env.CLAUDE_CODE_OAUTH_TOKEN = rc.accessToken;
          console.log("[botAuth] Recovered token from shared file after refresh failure.");
          return true;
        }
        return false;
      }
      const t = await resp.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
      const updated: BotOAuthCreds = {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? c.refreshToken,
        expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : Date.now() + 8 * 60 * 60 * 1000,
        scopes: t.scope ? t.scope.split(" ") : c.scopes,
        subscriptionType: c.subscriptionType,
        rateLimitTier: c.rateLimitTier,
      };
      writeBotCreds(updated);
      process.env.CLAUDE_CODE_OAUTH_TOKEN = updated.accessToken;
      console.log("[botAuth] Bot token refreshed, new expiry:", new Date(updated.expiresAt).toISOString());
      return true;
    } catch (err) {
      console.error("[botAuth] Refresh error:", err);
      return false;
    }
  })().finally(() => { botRefreshInFlight = null; });
  return botRefreshInFlight;
}

let botRefreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the bot-private token manager.
 * Returns true if the bot is now authenticating via its own isolated token,
 * false if seeding failed (caller should fall back to shared-file refresh).
 */
export function startBotTokenManager(): boolean {
  if (botRefreshTimer) return true;

  // If an external long-lived token was provided (e.g. `claude setup-token`)
  // and there is no bot-private store, trust it verbatim and don't manage refresh.
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN && !readBotCreds()) {
    console.log("[botAuth] External CLAUDE_CODE_OAUTH_TOKEN provided; using as-is (no managed refresh).");
    return true;
  }

  if (!seedBotCredsFromShared()) return false;
  applyBotTokenToEnv();

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;          // 5 min
  const REFRESH_THRESHOLD_MS = 2 * 60 * 60 * 1000;  // refresh when <2h left

  const tick = async () => {
    try {
      const c = readBotCreds();
      if (!c) return;
      const left = c.expiresAt - Date.now();
      if (left <= REFRESH_THRESHOLD_MS) {
        console.log(`[botAuth] Bot token ${Math.round(left / 60000)}m left, refreshing proactively...`);
        const ok = await refreshBotToken();
        if (!ok) console.warn("[botAuth] Bot token refresh failed — will retry next cycle.");
      } else {
        applyBotTokenToEnv();
      }
    } catch (err) {
      console.error("[botAuth] tick error:", err);
    }
  };

  tick();
  botRefreshTimer = setInterval(tick, CHECK_INTERVAL_MS);
  console.log("[botAuth] Bot token manager started — isolated private creds, 5m check, refresh <2h. Shared credential file will NOT be touched.");
  return true;
}

export function stopBotTokenManager(): void {
  if (botRefreshTimer) {
    clearInterval(botRefreshTimer);
    botRefreshTimer = null;
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function readJsonFile(path: string): Record<string, unknown> {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function writeJsonFile(path: string, data: Record<string, unknown>, mode?: number): void {
  // Atomic write: write to a temp file then rename, so concurrently-spawned
  // claude cli.js processes never read a half-written credentials file.
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  if (mode) chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/**
 * Fetch user profile from Anthropic OAuth API.
 */
async function fetchProfile(accessToken: string): Promise<{
  subscriptionType: string | null;
  rateLimitTier: string | null;
  accountUuid?: string;
  emailAddress?: string;
  organizationUuid?: string;
  displayName?: string;
  hasExtraUsageEnabled?: boolean;
  billingType?: string;
  accountCreatedAt?: string;
  subscriptionCreatedAt?: string;
} | null> {
  try {
    const resp = await fetch(OAUTH_CONFIG.PROFILE_URL, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return null;

    const data = await resp.json() as {
      account?: { uuid?: string; email?: string; display_name?: string; created_at?: string };
      organization?: {
        uuid?: string;
        organization_type?: string;
        rate_limit_tier?: string;
        has_extra_usage_enabled?: boolean;
        billing_type?: string;
        subscription_created_at?: string;
      };
    };

    let subscriptionType: string | null = null;
    switch (data.organization?.organization_type) {
      case "claude_max": subscriptionType = "max"; break;
      case "claude_pro": subscriptionType = "pro"; break;
      case "claude_enterprise": subscriptionType = "enterprise"; break;
      case "claude_team": subscriptionType = "team"; break;
    }

    return {
      subscriptionType,
      rateLimitTier: data.organization?.rate_limit_tier ?? null,
      accountUuid: data.account?.uuid,
      emailAddress: data.account?.email,
      organizationUuid: data.organization?.uuid,
      displayName: data.account?.display_name,
      hasExtraUsageEnabled: data.organization?.has_extra_usage_enabled,
      billingType: data.organization?.billing_type,
      accountCreatedAt: data.account?.created_at,
      subscriptionCreatedAt: data.organization?.subscription_created_at,
    };
  } catch (err) {
    console.error("[claudeAuth] Profile fetch failed:", err);
    return null;
  }
}

/**
 * Start the OAuth login flow directly (no Ink UI dependency).
 * Returns a LoginSession with the OAuth URL and a submitCode function.
 */
export function startLogin(): LoginSession {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = base64url(randomBytes(32));

  const params = new URLSearchParams({
    code: "true",
    client_id: OAUTH_CONFIG.CLIENT_ID,
    response_type: "code",
    redirect_uri: OAUTH_CONFIG.REDIRECT_URI,
    scope: OAUTH_CONFIG.SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  const url = `${OAUTH_CONFIG.AUTHORIZE_URL}?${params.toString()}`;
  let cancelled = false;

  return {
    url,
    submitCode: async (rawInput: string): Promise<string | null> => {
      if (cancelled) return "Login cancelled";

      try {
        // Extract authorization code - handle URL or plain code input
        let code = rawInput.trim();

        // If user pasted the full callback URL, extract the code parameter
        if (code.includes("code=")) {
          try {
            const url = new URL(code);
            code = url.searchParams.get("code") ?? code;
          } catch {
            const match = code.match(/code=([^&\s]+)/);
            if (match) code = match[1];
          }
        }

        // Strip any Discord formatting or whitespace
        code = code.replace(/[`*_~\n\r]/g, "").trim();

        // The callback page displays "authorizationCode#state" as a single string.
        // Split on '#' - first part is the actual OAuth code.
        if (code.includes("#")) {
          const [authCode] = code.split("#");
          if (!authCode) {
            return "Invalid code format. Please make sure the full code was copied.";
          }
          console.log("[claudeAuth] Split code on '#': auth code length:", authCode.length);
          code = authCode;
        }

        // Step 1: Exchange authorization code for OAuth tokens
        console.log("[claudeAuth] Exchanging code for token, code length:", code.length);
        const tokenResponse = await fetch(OAUTH_CONFIG.TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            redirect_uri: OAUTH_CONFIG.REDIRECT_URI,
            client_id: OAUTH_CONFIG.CLIENT_ID,
            code_verifier: codeVerifier,
            state,
          }),
        });

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          console.error("[claudeAuth] Token exchange failed:", tokenResponse.status, errText);
          return `Token exchange failed (${tokenResponse.status}): ${errText}`;
        }

        const tokenData = await tokenResponse.json() as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
          account_uuid?: string;
        };

        console.log("[claudeAuth] Token exchange successful");

        // Step 2: Fetch user profile to get subscription type
        console.log("[claudeAuth] Fetching user profile...");
        const profile = await fetchProfile(tokenData.access_token);
        console.log("[claudeAuth] Profile:", profile?.subscriptionType, profile?.displayName);

        // Step 3: Save OAuth tokens to ~/.claude/.credentials.json (same as CLI)
        if (!existsSync(CLAUDE_DIR)) {
          mkdirSync(CLAUDE_DIR, { recursive: true });
        }

        const scopes = tokenData.scope?.split(" ") ?? [];
        const expiresAt = tokenData.expires_in
          ? Date.now() + tokenData.expires_in * 1000
          : undefined;

        const credentials = readJsonFile(CREDENTIALS_PATH);
        credentials.claudeAiOauth = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          scopes,
          subscriptionType: profile?.subscriptionType ?? null,
          rateLimitTier: profile?.rateLimitTier ?? null,
        };
        writeJsonFile(CREDENTIALS_PATH, credentials, 0o600);
        console.log("[claudeAuth] Credentials saved to", CREDENTIALS_PATH);

        // Step 4: Save account info to ~/.claude.json (same as CLI)
        const config = readJsonFile(CONFIG_PATH);
        if (profile) {
          config.oauthAccount = {
            accountUuid: profile.accountUuid,
            emailAddress: profile.emailAddress,
            organizationUuid: profile.organizationUuid,
            displayName: profile.displayName,
            hasExtraUsageEnabled: profile.hasExtraUsageEnabled ?? false,
            billingType: profile.billingType,
            accountCreatedAt: profile.accountCreatedAt,
            subscriptionCreatedAt: profile.subscriptionCreatedAt,
          };
        }
        config.hasCompletedOnboarding = true;
        writeJsonFile(CONFIG_PATH, config);
        console.log("[claudeAuth] Config saved to", CONFIG_PATH);

        return null; // success
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[claudeAuth] Login error:", err);
        return `Unexpected error: ${errMsg}`;
      }
    },
    cancel: () => { cancelled = true; },
  };
}
