import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

export interface StoredMessage {
  id: string;
  threadId: string;
  timestamp: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  cost?: number;
}

class MessageStore {
  private db: Database.Database;

  constructor() {
    // Store DB in project root/data directory (use cwd for runtime path)
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = join(dataDir, 'messages.db');
    this.db = new Database(dbPath);

    this.init();
  }

  private init(): void {
    // Create messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        cost REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(thread_id, timestamp);
    `);

    // Create threads metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        thread_name TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);
  }

  addMessage(message: StoredMessage): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, thread_id, timestamp, role, content, cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(message.id, message.threadId, message.timestamp, message.role, message.content, message.cost ?? null);

    // Update thread's updated_at
    const updateThread = this.db.prepare(`
      UPDATE threads SET updated_at = strftime('%s', 'now') WHERE thread_id = ?
    `);
    updateThread.run(message.threadId);
  }

  getMessages(threadId: string, limit = 100): StoredMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, thread_id as threadId, timestamp, role, content, cost
      FROM messages
      WHERE thread_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);
    return stmt.all(threadId, limit) as StoredMessage[];
  }

  getRecentMessages(threadId: string, afterTimestamp: number): StoredMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, thread_id as threadId, timestamp, role, content, cost
      FROM messages
      WHERE thread_id = ? AND timestamp > ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(threadId, afterTimestamp) as StoredMessage[];
  }

  updateMessage(id: string, content: string): void {
    const stmt = this.db.prepare(`
      UPDATE messages SET content = ? WHERE id = ?
    `);
    stmt.run(content, id);
  }

  deleteMessage(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM messages WHERE id = ?`);
    stmt.run(id);
  }

  // Thread metadata
  upsertThread(threadId: string, channelId: string, threadName?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO threads (thread_id, channel_id, thread_name)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        thread_name = COALESCE(excluded.thread_name, thread_name),
        updated_at = strftime('%s', 'now')
    `);
    stmt.run(threadId, channelId, threadName ?? null);
  }

  getThread(threadId: string): { threadId: string; channelId: string; threadName?: string } | null {
    const stmt = this.db.prepare(`
      SELECT thread_id as threadId, channel_id as channelId, thread_name as threadName
      FROM threads WHERE thread_id = ?
    `);
    return stmt.get(threadId) as { threadId: string; channelId: string; threadName?: string } | null;
  }

  // Cleanup old messages (optional)
  cleanupOldMessages(daysOld = 30): number {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(`DELETE FROM messages WHERE timestamp < ?`);
    const result = stmt.run(cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let instance: MessageStore | null = null;
let cleanupScheduled = false;

export function getMessageStore(): MessageStore {
  if (!instance) {
    instance = new MessageStore();

    // Schedule cleanup on first access (only once)
    if (!cleanupScheduled) {
      cleanupScheduled = true;
      // Cleanup messages older than 30 days on startup
      const deleted = instance.cleanupOldMessages(30);
      if (deleted > 0) {
        console.log(`[MessageStore] Cleaned up ${deleted} old messages`);
      }
    }
  }
  return instance;
}

export function closeMessageStore(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
