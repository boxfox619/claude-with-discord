// Agent Visualization Client

class AgentVisualization {
  constructor() {
    this.ws = null;
    this.channels = [];
    this.selectedSession = null;
    this.messages = [];
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.collapsedChannels = new Set(); // Track collapsed state locally

    this.init();
  }

  init() {
    this.bindEvents();
    this.connect();
  }

  bindEvents() {
    document.getElementById('logout-btn').addEventListener('click', () => this.logout());
    document.getElementById('close-chat-btn').addEventListener('click', () => this.closeChat());
    document.getElementById('chat-form').addEventListener('submit', (e) => this.sendMessage(e));
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.updateConnectionStatus(true);
      this.reconnectAttempts = 0;
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.updateConnectionStatus(false);
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    }
  }

  updateConnectionStatus(connected) {
    const status = document.getElementById('connection-status');
    if (connected) {
      status.textContent = 'Connected';
      status.className = 'status-connected';
    } else {
      status.textContent = 'Disconnected';
      status.className = 'status-disconnected';
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'auth_required':
        window.location.href = '/login';
        break;
      case 'sessions':
        this.channels = message.data;
        this.renderWorld();
        break;
      case 'conversation':
        if (message.data.threadId === this.selectedSession?.threadId) {
          this.messages = message.data.messages;
          this.renderMessages();
        }
        break;
      case 'message':
        if (message.data.threadId === this.selectedSession?.threadId) {
          this.messages.push(message.data.message);
          this.renderMessages();
          this.scrollToBottom();
        }
        break;
      case 'session_update':
        // Update will come with next sessions broadcast
        break;
      case 'session_created':
        // Auto-subscribe to the new session
        if (message.data.threadId) {
          this.selectSessionById(message.data.threadId, message.data.channelId);
        }
        break;
      case 'error':
        console.error('Server error:', message.data);
        break;
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  renderWorld() {
    const world = document.getElementById('world');
    world.innerHTML = '';

    for (const channel of this.channels) {
      const room = this.createRoom(channel);
      world.appendChild(room);
    }

    // Update selected session info if open
    if (this.selectedSession) {
      const session = this.findSession(this.selectedSession.threadId);
      if (session) {
        this.selectedSession = session;
        this.updateChatInfo(session);
      }
    }

    // Handle pending session selection from create_session
    if (this._pendingSelect) {
      const session = this.findSession(this._pendingSelect.threadId);
      if (session) {
        this.selectedSession = session;
        this.updateChatInfo(session);
        this._pendingSelect = null;
      }
    }
  }

  createRoom(channel) {
    const room = document.createElement('div');
    room.className = 'room';

    // Initialize collapsed state from server config on first load
    if (channel.collapsed && !this.collapsedChannels.has(channel.channelId) && !this._initializedChannels?.has(channel.channelId)) {
      this.collapsedChannels.add(channel.channelId);
    }
    this._initializedChannels = this._initializedChannels || new Set();
    this._initializedChannels.add(channel.channelId);

    const isCollapsed = this.collapsedChannels.has(channel.channelId);

    const header = document.createElement('div');
    header.className = 'room-header';
    header.innerHTML = `
      <div class="room-toggle">${isCollapsed ? '▶' : '▼'}</div>
      <div class="room-icon">#</div>
      <div>
        <div class="room-name">${this.escapeHtml(channel.channelName)}</div>
        <div class="room-path">${this.escapeHtml(channel.projectPath)}</div>
      </div>
      <button class="room-new-session" title="New Session">+</button>
      <div class="room-session-count">${channel.sessions.length}</div>
    `;
    header.style.cursor = 'pointer';

    // New session button
    const newBtn = header.querySelector('.room-new-session');
    newBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.createSession(channel.channelId);
    });

    header.addEventListener('click', () => this.toggleChannel(channel.channelId));
    room.appendChild(header);

    const floor = document.createElement('div');
    floor.className = 'room-floor';
    floor.style.display = isCollapsed ? 'none' : 'flex';

    if (channel.sessions.length === 0) {
      floor.innerHTML = '<div class="room-empty">No active sessions</div>';
    } else {
      for (const session of channel.sessions) {
        const agent = this.createAgent(session);
        floor.appendChild(agent);
      }
    }

    room.appendChild(floor);
    return room;
  }

  toggleChannel(channelId) {
    if (this.collapsedChannels.has(channelId)) {
      this.collapsedChannels.delete(channelId);
    } else {
      this.collapsedChannels.add(channelId);
    }
    this.renderWorld();
  }

  createAgent(session, isSubsession = false) {
    const container = document.createElement('div');
    container.className = isSubsession ? 'agent subsession' : 'agent';

    const avatar = document.createElement('div');
    avatar.className = `agent-avatar ${session.status}`;
    avatar.textContent = isSubsession ? '🔧' : '🤖';

    const name = document.createElement('div');
    name.className = 'agent-name';
    name.textContent = session.alias || session.channelName || session.threadId.slice(-6);
    name.title = session.channelName || session.threadId;

    const cost = document.createElement('div');
    cost.className = 'agent-cost';
    cost.textContent = `$${session.cost.toFixed(4)}`;

    container.appendChild(avatar);
    container.appendChild(name);
    container.appendChild(cost);

    container.addEventListener('click', () => this.selectSession(session));

    // Add subsessions if any
    if (session.subsessions && session.subsessions.length > 0) {
      const subsessionContainer = document.createElement('div');
      subsessionContainer.className = 'subsession-container';

      const line = document.createElement('div');
      line.className = 'subsession-line';
      subsessionContainer.appendChild(line);

      const subsessions = document.createElement('div');
      subsessions.className = 'subsessions';

      for (const sub of session.subsessions) {
        const subAgent = this.createAgent(sub, true);
        subsessions.appendChild(subAgent);
      }

      subsessionContainer.appendChild(subsessions);
      container.appendChild(subsessionContainer);
    }

    return container;
  }

  selectSession(session) {
    this.selectedSession = session;
    this.messages = [];

    // Subscribe to session messages
    this.send({ type: 'subscribe', threadId: session.threadId });

    // Show chat panel
    document.getElementById('chat-panel').classList.remove('hidden');
    this.updateChatInfo(session);
    this.renderMessages();
  }

  updateChatInfo(session) {
    document.getElementById('chat-session-name').textContent =
      session.alias || session.channelName || `Session ${session.threadId.slice(-6)}`;

    const statusEl = document.getElementById('chat-session-status');
    statusEl.textContent = session.status;
    statusEl.className = `session-status ${session.status}`;

    document.getElementById('chat-mode').textContent = session.mode;
    document.getElementById('chat-cost').textContent = session.cost.toFixed(4);
  }

  closeChat() {
    if (this.selectedSession) {
      this.send({ type: 'unsubscribe', threadId: this.selectedSession.threadId });
    }
    this.selectedSession = null;
    this.messages = [];
    document.getElementById('chat-panel').classList.add('hidden');
  }

  renderMessages() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';

    for (const msg of this.messages) {
      const msgEl = document.createElement('div');
      msgEl.className = `message ${msg.role}`;
      msgEl.innerHTML = `
        <div class="message-content">${this.formatMessage(msg.content)}</div>
        <div class="message-time">${this.formatTime(msg.timestamp)}</div>
      `;
      container.appendChild(msgEl);
    }

    this.scrollToBottom();
  }

  scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const content = input.value.trim();

    if (!content || !this.selectedSession) return;

    this.send({
      type: 'send_message',
      threadId: this.selectedSession.threadId,
      content
    });

    input.value = '';
  }

  createSession(channelId) {
    const message = prompt('Enter initial message (or leave empty to just create thread):');
    if (message === null) return; // cancelled

    this.send({
      type: 'create_session',
      channelId,
      content: message || undefined,
    });
  }

  selectSessionById(threadId, channelId) {
    // Wait for next broadcast to include the new session, then select it
    this._pendingSelect = { threadId, channelId };
    // Fallback: open chat panel immediately with minimal info
    this.selectedSession = {
      threadId,
      channelId,
      channelName: 'New Session',
      status: 'idle',
      mode: 'action',
      cost: 0,
      lastActivity: Date.now(),
      isSubsession: false,
    };
    this.messages = [];
    this.send({ type: 'subscribe', threadId });
    document.getElementById('chat-panel').classList.remove('hidden');
    this.updateChatInfo(this.selectedSession);
    this.renderMessages();
  }

  findSession(threadId) {
    for (const channel of this.channels) {
      for (const session of channel.sessions) {
        if (session.threadId === threadId) return session;
        if (session.subsessions) {
          for (const sub of session.subsessions) {
            if (sub.threadId === threadId) return sub;
          }
        }
      }
    }
    return null;
  }

  formatMessage(content) {
    // Basic markdown-like formatting
    return this.escapeHtml(content)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async logout() {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  new AgentVisualization();
});
