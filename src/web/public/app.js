// Agent Visualization Client

class AgentVisualization {
  constructor() {
    this.ws = null;
    this.channels = [];
    this.selectedSession = null;
    this.messages = [];
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.collapsedChannels = new Set(); // Will be loaded from server
    this.sortable = null;
    this.channelOrder = []; // Will be loaded from server
    this.channelEmojis = {}; // Will be loaded from server
    this.channelPrompts = {}; // Will be loaded from server
    this.pendingFiles = []; // Files waiting to be sent

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
    this.setupChatResize();
    this.setupFileAttachment();
  }

  setupChatResize() {
    const chatPanel = document.getElementById('chat-panel');

    // Create resize handle
    const handle = document.createElement('div');
    handle.className = 'chat-resize-handle';
    chatPanel.insertBefore(handle, chatPanel.firstChild);

    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = chatPanel.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = startX - e.clientX;
      const newWidth = Math.max(350, Math.min(startWidth + diff, window.innerWidth * 0.8));
      chatPanel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  setupFileAttachment() {
    const chatPanel = document.getElementById('chat-panel');
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const filePreview = document.getElementById('file-preview');

    // Attach button click
    attachBtn.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
      fileInput.value = ''; // Reset input
    });

    // Drag and drop
    chatPanel.addEventListener('dragover', (e) => {
      e.preventDefault();
      chatPanel.classList.add('drag-over');
      if (!chatPanel.querySelector('.drag-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'drag-overlay';
        overlay.textContent = 'Drop files here';
        chatPanel.appendChild(overlay);
      }
    });

    chatPanel.addEventListener('dragleave', (e) => {
      if (!chatPanel.contains(e.relatedTarget)) {
        chatPanel.classList.remove('drag-over');
        const overlay = chatPanel.querySelector('.drag-overlay');
        if (overlay) overlay.remove();
      }
    });

    chatPanel.addEventListener('drop', (e) => {
      e.preventDefault();
      chatPanel.classList.remove('drag-over');
      const overlay = chatPanel.querySelector('.drag-overlay');
      if (overlay) overlay.remove();

      if (e.dataTransfer.files.length > 0) {
        this.handleFiles(e.dataTransfer.files);
      }
    });

    // Paste image support
    document.addEventListener('paste', (e) => {
      if (!this.selectedSession) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const files = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        this.handleFiles(files);
      }
    });
  }

  handleFiles(fileList) {
    const files = Array.from(fileList);
    const maxSize = 8 * 1024 * 1024; // 8MB limit

    for (const file of files) {
      if (file.size > maxSize) {
        alert(`File "${file.name}" is too large. Max size is 8MB.`);
        continue;
      }
      this.addPendingFile(file);
    }
    this.renderFilePreview();
  }

  addPendingFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.pendingFiles.push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: e.target.result, // base64 data URL
      });
      this.renderFilePreview();
    };
    reader.readAsDataURL(file);
  }

  removePendingFile(index) {
    this.pendingFiles.splice(index, 1);
    this.renderFilePreview();
  }

  renderFilePreview() {
    const filePreview = document.getElementById('file-preview');

    if (this.pendingFiles.length === 0) {
      filePreview.classList.add('hidden');
      filePreview.innerHTML = '';
      return;
    }

    filePreview.classList.remove('hidden');
    filePreview.innerHTML = '';

    this.pendingFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-preview-item';

      const isImage = file.type.startsWith('image/');

      if (isImage) {
        const img = document.createElement('img');
        img.src = file.data;
        img.alt = file.name;
        item.appendChild(img);
      } else {
        const icon = document.createElement('div');
        icon.className = 'file-icon';
        icon.textContent = this.getFileIcon(file.type);
        item.appendChild(icon);
      }

      const info = document.createElement('div');
      info.className = 'file-info';
      info.innerHTML = `
        <span class="file-name">${this.escapeHtml(file.name)}</span>
        <span class="file-size">${this.formatFileSize(file.size)}</span>
      `;
      item.appendChild(info);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-remove';
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', () => this.removePendingFile(index));
      item.appendChild(removeBtn);

      filePreview.appendChild(item);
    });
  }

  getFileIcon(type) {
    if (type.startsWith('image/')) return '🖼️';
    if (type.includes('json')) return '📋';
    if (type.includes('javascript') || type.includes('typescript')) return '📜';
    if (type.includes('python')) return '🐍';
    if (type.includes('html')) return '🌐';
    if (type.includes('css')) return '🎨';
    if (type.includes('text')) return '📄';
    return '📁';
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.updateConnectionStatus(true);
      this.reconnectAttempts = 0;
      this.fetchSettings();
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
      case 'queue_updated':
        // Queue was updated (item cancelled), refresh session info
        if (this.selectedSession?.threadId === message.data.threadId) {
          // Remove cancelled item from local queue display
          const session = this.findSession(message.data.threadId);
          if (session) {
            this.updateChatHeader(session);
          }
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

    // Sort channels by saved order
    const sortedChannels = this.sortChannels(this.channels);

    for (const channel of sortedChannels) {
      const room = this.createRoom(channel);
      room.dataset.channelId = channel.channelId;
      world.appendChild(room);
    }

    // Initialize Sortable for drag-and-drop
    this.initSortable(world);

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

  async fetchSettings() {
    try {
      const [orderRes, collapsedRes, emojisRes, promptsRes] = await Promise.all([
        fetch('/api/channel-order'),
        fetch('/api/collapsed-channels'),
        fetch('/api/channel-emojis'),
        fetch('/api/channel-prompts'),
      ]);
      const orderData = await orderRes.json();
      const collapsedData = await collapsedRes.json();
      const emojisData = await emojisRes.json();
      const promptsData = await promptsRes.json();
      this.channelOrder = orderData.order || [];
      this.collapsedChannels = new Set(collapsedData.collapsed || []);
      this.channelEmojis = emojisData.emojis || {};
      this.channelPrompts = promptsData.prompts || {};
      this.renderWorld();
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async saveChannelEmoji(channelId, emoji) {
    this.channelEmojis[channelId] = emoji;
    try {
      await fetch('/api/channel-emojis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, emoji }),
      });
    } catch (err) {
      console.error('Failed to save channel emoji:', err);
    }
  }

  async saveChannelPrompt(channelId, prompt) {
    if (prompt && prompt.trim()) {
      this.channelPrompts[channelId] = prompt.trim();
    } else {
      delete this.channelPrompts[channelId];
    }
    try {
      await fetch('/api/channel-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, prompt }),
      });
    } catch (err) {
      console.error('Failed to save channel prompt:', err);
    }
  }

  showPromptModal(channelId, channelName) {
    // Remove existing modal
    const existingModal = document.querySelector('.prompt-modal-overlay');
    if (existingModal) existingModal.remove();

    const currentPrompt = this.channelPrompts[channelId] || '';

    const overlay = document.createElement('div');
    overlay.className = 'prompt-modal-overlay';
    overlay.innerHTML = `
      <div class="prompt-modal">
        <div class="prompt-modal-header">
          <h3>System Prompt - ${this.escapeHtml(channelName)}</h3>
          <button class="prompt-modal-close">×</button>
        </div>
        <div class="prompt-modal-body">
          <textarea class="prompt-textarea" placeholder="Enter system prompt for this channel...">${this.escapeHtml(currentPrompt)}</textarea>
          <p class="prompt-hint">This prompt will be included in every session for this channel.</p>
        </div>
        <div class="prompt-modal-footer">
          <button class="prompt-btn-cancel">Cancel</button>
          <button class="prompt-btn-save">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('.prompt-textarea');
    const closeBtn = overlay.querySelector('.prompt-modal-close');
    const cancelBtn = overlay.querySelector('.prompt-btn-cancel');
    const saveBtn = overlay.querySelector('.prompt-btn-save');

    const closeModal = () => overlay.remove();

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    saveBtn.addEventListener('click', async () => {
      await this.saveChannelPrompt(channelId, textarea.value);
      closeModal();
      this.renderWorld(); // Re-render to update indicator
    });

    // Focus textarea
    textarea.focus();
  }

  showEmojiPicker(channelId, targetEl) {
    // Remove existing picker
    const existingPicker = document.querySelector('.emoji-picker');
    if (existingPicker) existingPicker.remove();

    // Common emojis for project identification
    const emojis = [
      '📦', '🚀', '💻', '🔧', '⚙️', '🎯', '📱', '🌐',
      '🔥', '💡', '📊', '🎨', '🛠️', '📝', '🔒', '🎮',
      '🤖', '💾', '📡', '🧪', '🔬', '🏗️', '📈', '🎵',
      '🛒', '💰', '🏠', '📚', '✨', '⭐', '🌟', '#',
    ];

    const picker = document.createElement('div');
    picker.className = 'emoji-picker';

    emojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-option';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        this.saveChannelEmoji(channelId, emoji);
        targetEl.textContent = emoji;
        picker.remove();
      });
      picker.appendChild(btn);
    });

    // Position picker near the target
    const rect = targetEl.getBoundingClientRect();
    picker.style.top = `${rect.bottom + 5}px`;
    picker.style.left = `${rect.left}px`;

    document.body.appendChild(picker);

    // Close picker on outside click
    const closeHandler = (e) => {
      if (!picker.contains(e.target) && e.target !== targetEl) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  async saveChannelOrder(order) {
    this.channelOrder = order;
    try {
      await fetch('/api/channel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
    } catch (err) {
      console.error('Failed to save channel order:', err);
    }
  }

  async saveCollapsedChannels() {
    try {
      await fetch('/api/collapsed-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collapsed: [...this.collapsedChannels] }),
      });
    } catch (err) {
      console.error('Failed to save collapsed channels:', err);
    }
  }

  sortChannels(channels) {
    if (this.channelOrder.length === 0) {
      return channels;
    }

    const orderMap = new Map(this.channelOrder.map((id, index) => [id, index]));
    return [...channels].sort((a, b) => {
      const orderA = orderMap.has(a.channelId) ? orderMap.get(a.channelId) : Infinity;
      const orderB = orderMap.has(b.channelId) ? orderMap.get(b.channelId) : Infinity;
      return orderA - orderB;
    });
  }

  initSortable(world) {
    if (this.sortable) {
      this.sortable.destroy();
    }

    this.sortable = new Sortable(world, {
      animation: 150,
      ghostClass: 'room-ghost',
      chosenClass: 'room-chosen',
      dragClass: 'room-drag',
      handle: '.room-header',
      onEnd: () => {
        const rooms = world.querySelectorAll('.room');
        const newOrder = Array.from(rooms).map(room => room.dataset.channelId);
        this.saveChannelOrder(newOrder);
      }
    });
  }

  createRoom(channel) {
    const room = document.createElement('div');
    const isCollapsed = this.collapsedChannels.has(channel.channelId);
    room.className = isCollapsed ? 'room collapsed' : 'room';

    // Count active sessions (only show when collapsed and has sessions)
    const sessionCount = channel.sessions.length;
    const showCount = isCollapsed && sessionCount > 0;

    // Get emoji for this channel (default to #)
    const emoji = this.channelEmojis[channel.channelId] || '#';
    const hasPrompt = !!this.channelPrompts[channel.channelId];

    const header = document.createElement('div');
    header.className = 'room-header';
    header.innerHTML = `
      <div class="room-toggle">${isCollapsed ? '▶' : '▼'}</div>
      <div class="room-icon" title="Click to change emoji">${emoji}</div>
      <div>
        <div class="room-name">${this.escapeHtml(channel.channelName)}${hasPrompt ? '<span class="prompt-indicator" title="Has system prompt">📋</span>' : ''}</div>
        <div class="room-path">${this.escapeHtml(channel.projectPath)}</div>
      </div>
      <button class="room-settings" title="System Prompt">⚙️</button>
      <button class="room-new-session" title="New Session">+</button>
      ${showCount ? `<div class="room-session-count">${sessionCount}</div>` : ''}
    `;
    header.style.cursor = 'pointer';

    // Emoji click handler
    const emojiBtn = header.querySelector('.room-icon');
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showEmojiPicker(channel.channelId, emojiBtn);
    });

    // Settings button (system prompt)
    const settingsBtn = header.querySelector('.room-settings');
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showPromptModal(channel.channelId, channel.channelName);
    });

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
    this.saveCollapsedChannels();
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

    // Update queue panel
    this.renderQueuePanel(session);
  }

  renderQueuePanel(session) {
    const queuePanel = document.getElementById('queue-panel');
    const queueList = document.getElementById('queue-list');
    const queueCount = document.getElementById('queue-count');

    const queued = session.queuedMessages || [];

    if (queued.length === 0) {
      queuePanel.classList.add('hidden');
      return;
    }

    queuePanel.classList.remove('hidden');
    queueCount.textContent = queued.length;
    queueList.innerHTML = '';

    queued.forEach((msg, idx) => {
      const item = document.createElement('div');
      item.className = 'queue-item';

      const content = document.createElement('div');
      content.className = 'queue-item-content';
      content.innerHTML = `
        <span class="queue-item-index">#${idx + 1}</span>
        <span class="queue-item-text">${this.escapeHtml(msg.content)}</span>
        ${msg.hasFiles ? '<span class="queue-item-files">📎</span>' : ''}
      `;

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'queue-item-cancel';
      cancelBtn.textContent = '×';
      cancelBtn.title = 'Cancel this message';
      cancelBtn.addEventListener('click', () => this.cancelQueuedMessage(session.threadId, idx));

      item.appendChild(content);
      item.appendChild(cancelBtn);
      queueList.appendChild(item);
    });
  }

  cancelQueuedMessage(threadId, queueIndex) {
    this.send({
      type: 'cancel_queued',
      threadId,
      queueIndex,
    });
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

    if ((!content && this.pendingFiles.length === 0) || !this.selectedSession) return;

    // Prepare files for sending
    const files = this.pendingFiles.map(f => ({
      name: f.name,
      type: f.type,
      data: f.data, // base64 data URL
    }));

    this.send({
      type: 'send_message',
      threadId: this.selectedSession.threadId,
      content: content || (files.length > 0 ? `[Attached ${files.length} file(s)]` : ''),
      files: files.length > 0 ? files : undefined,
    });

    input.value = '';
    this.pendingFiles = [];
    this.renderFilePreview();
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
    // Simple markdown parser
    let html = this.escapeHtml(content);

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers (### > ## > #)
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Blockquote (> text)
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rule (---)
    html = html.replace(/^---$/gm, '<hr>');

    // Unordered list (- item)
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Line breaks (but not inside pre/code blocks)
    html = html.replace(/\n/g, '<br>');

    // Clean up extra <br> around block elements
    html = html.replace(/<br>(<\/?(?:h[1-3]|ul|li|pre|blockquote|hr)>)/g, '$1');
    html = html.replace(/(<\/?(?:h[1-3]|ul|li|pre|blockquote|hr)>)<br>/g, '$1');

    return html;
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
