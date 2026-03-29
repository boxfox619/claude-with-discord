import { readFileSync, existsSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { resolve, join } from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import type { AppConfig } from "./types.js";

const CONFIG_PATH = resolve(process.cwd(), "config.json");
const PROMPTS_DIR = resolve(process.cwd(), "prompts");

// Config without system prompts (stored in separate files)
interface StoredConfig extends Omit<AppConfig, "channel_system_prompts"> {
  channel_system_prompts?: Record<string, string>; // Optional, for backward compatibility
}

const DEFAULTS: StoredConfig = {
  channel_project_map: {},
  global_context: "",
  permission_mode: "acceptEdits",
  max_budget_usd: 5.0,
  max_turns: 50,
  max_concurrent_sessions: 5,
  session_timeout_minutes: 1440,
  allowed_users: [],
  openai_api_key: process.env.OPENAI_API_KEY,
};

/**
 * Load system prompts from prompts/ directory.
 * Falls back to inline prompts in config.json for backward compatibility.
 */
function loadSystemPrompts(inlinePrompts?: Record<string, string>): Record<string, string> {
  const prompts: Record<string, string> = {};

  // Load from prompts/ directory
  if (existsSync(PROMPTS_DIR)) {
    const files = readdirSync(PROMPTS_DIR).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const channelId = file.replace(".md", "");
      try {
        prompts[channelId] = readFileSync(join(PROMPTS_DIR, file), "utf-8");
      } catch (err) {
        console.error(`Failed to read prompt file ${file}:`, err);
      }
    }
  }

  // Fallback: merge inline prompts (for channels not in prompts/)
  if (inlinePrompts) {
    for (const [channelId, prompt] of Object.entries(inlinePrompts)) {
      if (!prompts[channelId]) {
        prompts[channelId] = prompt;
      }
    }
  }

  return prompts;
}

type ConfigChangeCallback = (oldConfig: AppConfig, newConfig: AppConfig) => void;

/**
 * ConfigManager provides hot-reloading of config using lowdb.
 * - Main config from config.json (via lowdb)
 * - System prompts from prompts/*.md files
 */
class ConfigManager {
  private db: Low<StoredConfig> | null = null;
  private _config: AppConfig;
  private configWatcher: FSWatcher | null = null;
  private promptsWatcher: FSWatcher | null = null;
  private reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  private changeCallbacks: ConfigChangeCallback[] = [];
  private isInitialized = false;

  constructor() {
    // Synchronous initial load
    this._config = this.loadConfigSync();
    this.startWatching();

    // Initialize lowdb asynchronously
    this.initDb();
  }

  private loadConfigSync(): AppConfig {
    let stored: StoredConfig = { ...DEFAULTS };

    if (existsSync(CONFIG_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        stored = { ...DEFAULTS, ...raw };
      } catch (err) {
        console.error("Failed to parse config.json:", err);
      }
    } else {
      console.warn(`config.json not found at ${CONFIG_PATH}, using defaults`);
    }

    // Validate project paths
    for (const [channelId, path] of Object.entries(stored.channel_project_map)) {
      if (!existsSync(path)) {
        console.warn(`Warning: project path "${path}" for channel ${channelId} does not exist`);
      }
    }

    if (Object.keys(stored.channel_project_map).length === 0) {
      console.warn("Warning: no channel-project mappings configured");
    }

    // Load system prompts from files (with fallback to inline)
    const systemPrompts = loadSystemPrompts(stored.channel_system_prompts);

    return {
      ...stored,
      channel_system_prompts: systemPrompts,
    };
  }

  private async initDb(): Promise<void> {
    try {
      const adapter = new JSONFile<StoredConfig>(CONFIG_PATH);
      this.db = new Low(adapter, DEFAULTS);
      await this.db.read();
      this.isInitialized = true;
      console.log("Config database initialized");
    } catch (err) {
      console.error("Failed to initialize lowdb:", err);
    }
  }

  get config(): AppConfig {
    return this._config;
  }

  /**
   * Register a callback to be called when config changes.
   */
  onConfigChange(callback: ConfigChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  private startWatching(): void {
    // Watch config.json
    if (existsSync(CONFIG_PATH)) {
      try {
        this.configWatcher = watch(CONFIG_PATH, (eventType) => {
          if (eventType === "change") {
            this.scheduleReload();
          }
        });
        this.configWatcher.on("error", (err) => {
          console.error("Config watcher error:", err);
        });
      } catch (err) {
        console.error("Failed to watch config file:", err);
      }
    }

    // Watch prompts/ directory
    if (existsSync(PROMPTS_DIR)) {
      try {
        this.promptsWatcher = watch(PROMPTS_DIR, (eventType, filename) => {
          if (filename?.endsWith(".md")) {
            this.scheduleReload();
          }
        });
        this.promptsWatcher.on("error", (err) => {
          console.error("Prompts watcher error:", err);
        });
      } catch (err) {
        console.error("Failed to watch prompts directory:", err);
      }
    }
  }

  private scheduleReload(): void {
    // Debounce to handle multiple rapid changes
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }
    this.reloadTimeout = setTimeout(() => {
      this.reload();
    }, 200); // Increased debounce for better stability
  }

  private async reload(): Promise<void> {
    try {
      const oldConfig = this._config;

      // Reload from lowdb if initialized
      if (this.db && this.isInitialized) {
        await this.db.read();
      }

      const newConfig = this.loadConfigSync();
      this._config = newConfig;
      console.log("Config reloaded successfully");

      // Notify callbacks
      for (const callback of this.changeCallbacks) {
        try {
          callback(oldConfig, newConfig);
        } catch (err) {
          console.error("Config change callback error:", err);
        }
      }
    } catch (err) {
      console.error("Failed to reload config:", err);
    }
  }

  /**
   * Update config programmatically (persists to config.json).
   */
  async updateConfig(updates: Partial<StoredConfig>): Promise<void> {
    if (!this.db || !this.isInitialized) {
      throw new Error("Config database not initialized");
    }

    const oldConfig = this._config;

    // Update lowdb
    this.db.data = { ...this.db.data, ...updates };
    await this.db.write();

    // Reload to apply changes
    this._config = this.loadConfigSync();

    // Notify callbacks
    for (const callback of this.changeCallbacks) {
      try {
        callback(oldConfig, this._config);
      } catch (err) {
        console.error("Config change callback error:", err);
      }
    }
  }

  /**
   * Manually reload config.
   */
  forceReload(): void {
    this.reload();
  }

  /**
   * Stop watching for changes.
   */
  destroy(): void {
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }
    if (this.promptsWatcher) {
      this.promptsWatcher.close();
      this.promptsWatcher = null;
    }
  }
}

// Singleton instance
let configManager: ConfigManager | null = null;

function getManager(): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  return configManager;
}

/**
 * Get the current config. This always returns the latest config,
 * automatically updated when config.json or prompts/*.md changes.
 */
export function getConfig(): AppConfig {
  return getManager().config;
}

/**
 * Legacy function for initial load. Returns the same as getConfig().
 * @deprecated Use getConfig() instead for hot-reloading support.
 */
export function loadConfig(): AppConfig {
  return getManager().config;
}

/**
 * Update config programmatically. Changes are persisted to config.json.
 */
export async function updateConfig(updates: Partial<StoredConfig>): Promise<void> {
  return getManager().updateConfig(updates);
}

/**
 * Manually reload config.
 */
export function reloadConfig(): void {
  getManager().forceReload();
}

/**
 * Stop config file watching.
 */
export function destroyConfigManager(): void {
  if (configManager) {
    configManager.destroy();
    configManager = null;
  }
}

/**
 * Register a callback to be called when config changes.
 */
export function onConfigChange(callback: ConfigChangeCallback): void {
  getManager().onConfigChange(callback);
}
