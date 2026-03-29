import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ngrok from 'ngrok';
import type { SessionManager } from '../claude/sessionManager.js';
import type { Client, TextChannel } from 'discord.js';
import { getConfig } from '../config.js';
import { authMiddleware, validatePassword, createSession, destroySession, getClientIp, isLockedOut, recordFailedAttempt, clearFailedAttempts } from './auth.js';
import { WsHandler } from './wsHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class VisualizationServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private wsHandler: WsHandler;
  private port: number;
  private discordClient: Client;
  private ngrokUrl: string | null = null;

  constructor(sessionManager: SessionManager, discordClient: Client) {
    const config = getConfig();
    this.port = config.visualization_port || 3848;
    this.discordClient = discordClient;

    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupMiddleware();
    this.setupRoutes();

    this.wsHandler = new WsHandler(this.wss, sessionManager, discordClient);
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(cookieParser());
    this.app.use(authMiddleware);
  }

  private setupRoutes(): void {
    // Login page
    this.app.get('/login', (_req: Request, res: Response) => {
      res.send(this.getLoginPage());
    });

    // Login API with brute force protection
    this.app.post('/api/login', (req: Request, res: Response) => {
      const { password } = req.body;
      const ip = getClientIp(req);

      // Check if locked out
      const lockStatus = isLockedOut(ip);
      if (lockStatus.locked) {
        const remainingMin = Math.ceil(lockStatus.remainingMs / 60000);
        res.status(429).json({
          success: false,
          error: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin > 1 ? 's' : ''}.`,
          lockedOut: true,
          remainingMs: lockStatus.remainingMs,
        });
        return;
      }

      if (validatePassword(password)) {
        clearFailedAttempts(ip);
        const token = createSession();
        res.cookie('viz_session', token, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
          sameSite: 'strict',
        });
        res.json({ success: true });
      } else {
        const result = recordFailedAttempt(ip);
        if (result.locked) {
          res.status(429).json({
            success: false,
            error: 'Too many failed attempts. Please try again later.',
            lockedOut: true,
            remainingMs: 30 * 60 * 1000,
          });
        } else {
          res.status(401).json({
            success: false,
            error: `Invalid password. ${result.attemptsRemaining} attempt${result.attemptsRemaining !== 1 ? 's' : ''} remaining.`,
            attemptsRemaining: result.attemptsRemaining,
          });
        }
      }
    });

    // Logout API
    this.app.post('/api/logout', (req: Request, res: Response) => {
      const token = req.cookies?.['viz_session'];
      if (token) {
        destroySession(token);
      }
      res.clearCookie('viz_session');
      res.json({ success: true });
    });

    // Static files
    this.app.use(express.static(join(__dirname, 'public')));

    // SPA fallback (Express 5 requires named wildcard parameter)
    this.app.get('/{*path}', (_req: Request, res: Response) => {
      res.sendFile(join(__dirname, 'public', 'index.html'));
    });
  }

  private getLoginPage(): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Visualization - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-container {
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    h1 {
      color: #fff;
      text-align: center;
      margin-bottom: 8px;
      font-size: 24px;
    }
    .subtitle {
      color: rgba(255,255,255,0.6);
      text-align: center;
      margin-bottom: 32px;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      color: rgba(255,255,255,0.8);
      margin-bottom: 8px;
      font-size: 14px;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      background: rgba(255,255,255,0.1);
      color: #fff;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #4f46e5;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover {
      opacity: 0.9;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      color: #ef4444;
      text-align: center;
      margin-top: 16px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>Agent Visualization</h1>
    <p class="subtitle">Enter password to access the dashboard</p>
    <form id="loginForm">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit" id="submitBtn">Login</button>
      <p class="error" id="error"></p>
    </form>
  </div>
  <script>
    const form = document.getElementById('loginForm');
    const error = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');
    let lockoutTimer = null;

    function setLockout(remainingMs) {
      submitBtn.disabled = true;
      const updateTimer = () => {
        const remaining = Math.ceil(remainingMs / 1000);
        if (remaining <= 0) {
          clearInterval(lockoutTimer);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Login';
          error.textContent = '';
          return;
        }
        const min = Math.floor(remaining / 60);
        const sec = remaining % 60;
        submitBtn.textContent = 'Locked (' + min + ':' + String(sec).padStart(2, '0') + ')';
        remainingMs -= 1000;
      };
      updateTimer();
      lockoutTimer = setInterval(updateTimer, 1000);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: document.getElementById('password').value })
        });
        const data = await res.json();
        if (data.success) {
          window.location.href = '/';
        } else {
          error.textContent = data.error || 'Invalid password';
          if (data.lockedOut && data.remainingMs) {
            setLockout(data.remainingMs);
            return;
          }
        }
      } catch (err) {
        error.textContent = 'Connection error';
      } finally {
        if (!lockoutTimer) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Login';
        }
      }
    });
  </script>
</body>
</html>`;
  }

  async start(): Promise<void> {
    this.server.listen(this.port, async () => {
      console.log(`Visualization server running on http://localhost:${this.port}`);

      // Start ngrok tunnel
      await this.startNgrokTunnel();
    });
  }

  private async startNgrokTunnel(): Promise<void> {
    const config = getConfig();

    try {
      // Connect ngrok
      this.ngrokUrl = await ngrok.connect({
        addr: this.port,
        region: 'jp', // Japan region for lower latency
      });

      console.log(`Ngrok tunnel: ${this.ngrokUrl}`);

      // Send to Discord settings channel
      await this.notifyDiscord();
    } catch (err) {
      console.error('Failed to start ngrok tunnel:', err);
    }
  }

  private async notifyDiscord(): Promise<void> {
    if (!this.ngrokUrl) return;

    const config = getConfig();
    const settingsChannelId = config.settings_channel_id;

    // Find the first available channel to send notification
    const targetChannelId = settingsChannelId || Object.keys(config.channel_project_map)[0];

    if (!targetChannelId) {
      console.warn('No channel available to send visualization URL');
      return;
    }

    try {
      const channel = await this.discordClient.channels.fetch(targetChannelId);
      if (channel && 'send' in channel) {
        const textChannel = channel as TextChannel;
        await textChannel.send({
          embeds: [{
            title: '🖥️ Visualization Dashboard',
            description: `Agent visualization server is now online.`,
            fields: [
              { name: 'URL', value: this.ngrokUrl, inline: false },
              { name: 'Local', value: `http://localhost:${this.port}`, inline: true },
            ],
            color: 0x4f46e5,
            timestamp: new Date().toISOString(),
          }],
        });
      }
    } catch (err) {
      console.error('Failed to send Discord notification:', err);
    }
  }

  getWsHandler(): WsHandler {
    return this.wsHandler;
  }

  getNgrokUrl(): string | null {
    return this.ngrokUrl;
  }

  async destroy(): Promise<void> {
    this.wsHandler.destroy();
    this.server.close();

    // Disconnect ngrok
    if (this.ngrokUrl) {
      try {
        await ngrok.disconnect();
        await ngrok.kill();
      } catch (err) {
        console.error('Failed to disconnect ngrok:', err);
      }
    }
  }
}
