import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { SessionManager } from '../claude/sessionManager.js';
import { ChannelType, type Client, type ThreadChannel, type Message } from 'discord.js';
import type { VisualSession, VisualChannel, WsServerMessage, WsClientMessage, ConversationMessage, ChannelDisplayConfig } from '../types.js';
import { validateWsAuth } from './auth.js';
import { getConfig } from '../config.js';
import { parse as parseCookie } from 'cookie';

interface AuthenticatedWebSocket extends WebSocket {
  isAuthenticated: boolean;
  subscribedThreadId?: string;
}

export class WsHandler {
  private wss: WebSocketServer;
  private sessionManager: SessionManager;
  private discordClient: Client;
  private conversationHistory = new Map<string, ConversationMessage[]>();
  private broadcastInterval!: ReturnType<typeof setInterval>;

  constructor(wss: WebSocketServer, sessionManager: SessionManager, discordClient: Client) {
    this.wss = wss;
    this.sessionManager = sessionManager;
    this.discordClient = discordClient;

    this.setupConnectionHandler();
    this.setupBroadcast();
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const authWs = ws as AuthenticatedWebSocket;

      // Check cookie authentication
      const cookies = req.headers.cookie ? parseCookie(req.headers.cookie) : {};
      const sessionToken = cookies['viz_session'];

      if (validateWsAuth(sessionToken)) {
        authWs.isAuthenticated = true;
        this.sendSessions(authWs);
      } else {
        authWs.isAuthenticated = false;
        this.send(authWs, { type: 'auth_required', data: null });
      }

      ws.on('message', (data) => this.handleMessage(authWs, data.toString()));
      ws.on('close', () => this.handleClose(authWs));
    });
  }

  private setupBroadcast(): void {
    // Broadcast session updates every 2 seconds
    this.broadcastInterval = setInterval(() => {
      this.broadcastSessions();
    }, 2000);
  }

  private handleMessage(ws: AuthenticatedWebSocket, data: string): void {
    try {
      const message: WsClientMessage = JSON.parse(data);

      switch (message.type) {
        case 'auth':
          this.handleAuth(ws, message.password);
          break;
        case 'get_sessions':
          if (ws.isAuthenticated) {
            this.sendSessions(ws);
          }
          break;
        case 'subscribe':
          if (ws.isAuthenticated && message.threadId) {
            ws.subscribedThreadId = message.threadId;
            this.sendConversation(ws, message.threadId);
          }
          break;
        case 'unsubscribe':
          ws.subscribedThreadId = undefined;
          break;
        case 'send_message':
          if (ws.isAuthenticated && message.threadId && message.content) {
            this.handleSendMessage(ws, message.threadId, message.content);
          }
          break;
        case 'create_session':
          if (ws.isAuthenticated && message.channelId) {
            this.handleCreateSession(ws, message.channelId, message.content);
          }
          break;
      }
    } catch (err) {
      console.error('[WsHandler] Failed to parse message:', err);
    }
  }

  private handleAuth(ws: AuthenticatedWebSocket, password: string | undefined): void {
    if (!password) {
      this.send(ws, { type: 'auth_result', data: { success: false } });
      return;
    }

    const config = getConfig();
    if (password === config.visualization_password) {
      ws.isAuthenticated = true;
      this.send(ws, { type: 'auth_result', data: { success: true } });
      this.sendSessions(ws);
    } else {
      this.send(ws, { type: 'auth_result', data: { success: false } });
    }
  }

  private handleClose(ws: AuthenticatedWebSocket): void {
    ws.subscribedThreadId = undefined;
  }

  private async handleSendMessage(ws: AuthenticatedWebSocket, threadId: string, content: string): Promise<void> {
    try {
      const session = this.sessionManager.getSession(threadId);
      if (!session) {
        this.send(ws, { type: 'error', data: { message: 'Session not found' } });
        return;
      }

      // Get the Discord thread
      const channel = await this.discordClient.channels.fetch(threadId);
      if (!channel || !('send' in channel)) {
        this.send(ws, { type: 'error', data: { message: 'Thread not found' } });
        return;
      }

      const thread = channel as ThreadChannel;

      // Send message through session manager
      await this.sessionManager.sendMessage(
        threadId,
        session.channelId,
        session.projectPath,
        `[Web] ${content}`,
        thread,
        [],
        [],
        []
      );

      // Add to conversation history
      this.addToConversation(threadId, {
        id: Date.now().toString(),
        timestamp: Date.now(),
        role: 'user',
        content: `[Web] ${content}`,
      });

    } catch (err) {
      console.error('[WsHandler] Failed to send message:', err);
      this.send(ws, { type: 'error', data: { message: 'Failed to send message' } });
    }
  }

  private async handleCreateSession(ws: AuthenticatedWebSocket, channelId: string, initialMessage?: string): Promise<void> {
    try {
      const config = getConfig();
      const projectPath = config.channel_project_map[channelId];
      if (!projectPath) {
        this.send(ws, { type: 'error', data: { message: 'Channel not configured for sessions' } });
        return;
      }

      // Fetch the Discord channel
      const channel = await this.discordClient.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        this.send(ws, { type: 'error', data: { message: 'Channel not found or not a text channel' } });
        return;
      }

      const textChannel = channel as import('discord.js').TextChannel;

      // Create thread with timestamp name
      const timestamp = new Date().toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const threadName = `Session ${timestamp}`;

      const thread = await textChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 60,
      });

      // Send initial message in thread
      await thread.send("*Session created from web. Send a message to start.*");

      // If initial message provided, send it immediately to start the session
      if (initialMessage?.trim()) {
        await this.sessionManager.sendMessage(
          thread.id,
          channelId,
          projectPath,
          `[Web] ${initialMessage}`,
          thread,
          [],
          [],
          []
        );

        this.addToConversation(thread.id, {
          id: Date.now().toString(),
          timestamp: Date.now(),
          role: 'user',
          content: `[Web] ${initialMessage}`,
        });
      }

      // Notify client of new session
      this.send(ws, {
        type: 'session_created',
        data: { threadId: thread.id, channelId, threadName },
      });

    } catch (err) {
      console.error('[WsHandler] Failed to create session:', err);
      this.send(ws, { type: 'error', data: { message: 'Failed to create session' } });
    }
  }

  private send(ws: WebSocket, message: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: WsServerMessage): void {
    for (const client of this.wss.clients) {
      const authClient = client as AuthenticatedWebSocket;
      if (authClient.isAuthenticated && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    }
  }

  private async sendSessions(ws: AuthenticatedWebSocket): Promise<void> {
    const channels = await this.getVisualChannels();
    this.send(ws, { type: 'sessions', data: channels });
  }

  private async broadcastSessions(): Promise<void> {
    const hasAuthenticatedClients = Array.from(this.wss.clients).some(
      (client) => (client as AuthenticatedWebSocket).isAuthenticated
    );

    if (!hasAuthenticatedClients) return;

    const channels = await this.getVisualChannels();
    this.broadcast({ type: 'sessions', data: channels });
  }

  private async getVisualChannels(): Promise<VisualChannel[]> {
    const config = getConfig();
    const channelMap = new Map<string, VisualChannel>();
    const displayConfigs = config.visualization_channels || {};

    // Initialize channels from config
    for (const [channelId, projectPath] of Object.entries(config.channel_project_map)) {
      const displayConfig = displayConfigs[channelId] || {};

      // Skip hidden channels
      if (displayConfig.hidden) continue;

      let channelName = displayConfig.name || channelId;
      if (!displayConfig.name) {
        try {
          const channel = await this.discordClient.channels.fetch(channelId);
          if (channel && 'name' in channel) {
            channelName = (channel as { name: string }).name;
          }
        } catch {
          // Channel not found, use ID as name
        }
      }

      channelMap.set(channelId, {
        channelId,
        channelName,
        projectPath,
        sessions: [],
        order: displayConfig.order ?? 999,
        collapsed: displayConfig.collapsed ?? false,
      });
    }

    // Get all sessions from SessionManager using reflection
    const sessions = (this.sessionManager as unknown as { sessions: Map<string, unknown> }).sessions;

    for (const [threadId, sessionData] of sessions) {
      const session = sessionData as {
        sessionId: string;
        threadId: string;
        channelId: string;
        isProcessing: boolean;
        pendingPermission?: unknown;
        mode: 'action' | 'plan' | 'ask';
        totalCostUsd: number;
        lastActivityAt: number;
        isSubsession: boolean;
        parentThreadId?: string;
        alias?: string;
        childSubsessions?: Map<number, { threadId: string }>;
      };

      const channelData = channelMap.get(session.channelId);
      if (!channelData) continue;

      // Get thread name
      let threadName = threadId;
      try {
        const thread = await this.discordClient.channels.fetch(threadId);
        if (thread && 'name' in thread) {
          threadName = (thread as { name: string }).name;
        }
      } catch {
        // Thread not found
      }

      // Determine status
      let status: 'idle' | 'processing' | 'waiting_permission' | 'error' = 'idle';
      if (session.pendingPermission) {
        status = 'waiting_permission';
      } else if (session.isProcessing) {
        status = 'processing';
      }

      const visualSession: VisualSession = {
        sessionId: session.sessionId,
        threadId: session.threadId,
        channelId: session.channelId,
        channelName: threadName,
        status,
        mode: session.mode,
        cost: session.totalCostUsd,
        lastActivity: session.lastActivityAt,
        isSubsession: session.isSubsession,
        parentThreadId: session.parentThreadId,
        alias: session.alias,
        subsessions: [],
      };

      // If main session, add to channel
      if (!session.isSubsession) {
        // Get subsessions
        if (session.childSubsessions) {
          for (const [, subState] of session.childSubsessions) {
            const subSession = sessions.get(subState.threadId);
            if (subSession) {
              const sub = subSession as typeof session;
              let subStatus: 'idle' | 'processing' | 'waiting_permission' | 'error' = 'idle';
              if (sub.pendingPermission) {
                subStatus = 'waiting_permission';
              } else if (sub.isProcessing) {
                subStatus = 'processing';
              }

              visualSession.subsessions?.push({
                sessionId: sub.sessionId,
                threadId: sub.threadId,
                channelId: sub.channelId,
                channelName: sub.alias || sub.threadId,
                status: subStatus,
                mode: sub.mode,
                cost: sub.totalCostUsd,
                lastActivity: sub.lastActivityAt,
                isSubsession: true,
                parentThreadId: session.threadId,
                alias: sub.alias,
              });
            }
          }
        }
        channelData.sessions.push(visualSession);
      }
    }

    // Sort channels by order
    return Array.from(channelMap.values()).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  private async sendConversation(ws: AuthenticatedWebSocket, threadId: string): Promise<void> {
    try {
      // Fetch messages from Discord API
      const channel = await this.discordClient.channels.fetch(threadId);
      if (!channel || (channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread)) {
        // Fallback to in-memory history
        const history = this.conversationHistory.get(threadId) || [];
        this.send(ws, { type: 'conversation', data: { threadId, messages: history } });
        return;
      }

      const thread = channel as ThreadChannel;
      const discordMessages = await thread.messages.fetch({ limit: 100 });

      // Convert Discord messages to ConversationMessage format
      const messages: ConversationMessage[] = [];
      const sortedMessages = [...discordMessages.values()].sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      for (const discordMsg of sortedMessages) {
        // Determine role based on author
        let role: 'user' | 'assistant' | 'system' = 'user';
        if (discordMsg.author.bot && discordMsg.author.id === this.discordClient.user?.id) {
          role = 'assistant';
        } else if (discordMsg.author.bot) {
          role = 'system';
        }

        // Skip empty messages
        const content = discordMsg.content.trim();
        if (!content && discordMsg.attachments.size === 0) continue;

        messages.push({
          id: discordMsg.id,
          timestamp: discordMsg.createdTimestamp,
          role,
          content: content || (discordMsg.attachments.size > 0 ? `[${discordMsg.attachments.size} attachment(s)]` : ''),
        });
      }

      // Merge with in-memory history for recent messages not yet in Discord
      const inMemoryHistory = this.conversationHistory.get(threadId) || [];
      const lastDiscordTimestamp = messages.length > 0 ? messages[messages.length - 1].timestamp : 0;
      const recentInMemory = inMemoryHistory.filter(m => m.timestamp > lastDiscordTimestamp);
      messages.push(...recentInMemory);

      this.send(ws, { type: 'conversation', data: { threadId, messages } });
    } catch (err) {
      console.error('[WsHandler] Failed to fetch Discord messages:', err);
      // Fallback to in-memory history
      const history = this.conversationHistory.get(threadId) || [];
      this.send(ws, { type: 'conversation', data: { threadId, messages: history } });
    }
  }

  // Public method to add messages to conversation history
  addToConversation(threadId: string, message: ConversationMessage): void {
    let history = this.conversationHistory.get(threadId);
    if (!history) {
      history = [];
      this.conversationHistory.set(threadId, history);
    }
    history.push(message);

    // Limit history size
    if (history.length > 100) {
      history.shift();
    }

    // Broadcast to subscribed clients
    for (const client of this.wss.clients) {
      const authClient = client as AuthenticatedWebSocket;
      if (
        authClient.isAuthenticated &&
        authClient.subscribedThreadId === threadId &&
        client.readyState === WebSocket.OPEN
      ) {
        this.send(authClient, { type: 'message', data: { threadId, message } });
      }
    }
  }

  // Public method to update session
  notifySessionUpdate(threadId: string): void {
    this.broadcastSessions();
  }

  destroy(): void {
    clearInterval(this.broadcastInterval);
    this.wss.close();
  }
}
