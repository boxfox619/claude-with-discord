import "dotenv/config";
import { loadConfig, getConfig, destroyConfigManager } from "./config.js";
import { createDiscordClient } from "./discord/client.js";
import {
  setupGlobalErrorHandlers,
  setupDiscordErrorHandlers,
  setErrorNotifierClient,
} from "./errorNotifier.js";
import { VisualizationServer } from "./web/server.js";
import { closeMessageStore } from "./db/messageStore.js";

// Setup global error handlers early (before Discord client is ready)
setupGlobalErrorHandlers();

// Load initial config (also starts file watcher)
loadConfig();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN is not set in .env");
  process.exit(1);
}

const { client, sessionManager } = createDiscordClient();

// Setup Discord-specific error handlers and notifier
setErrorNotifierClient(client);
setupDiscordErrorHandlers(client);

// Initialize visualization server if enabled
let visualizationServer: VisualizationServer | null = null;

client.once("ready", () => {
  const config = getConfig();
  if (config.visualization_enabled && config.visualization_password) {
    visualizationServer = new VisualizationServer(sessionManager, client);

    // Connect message events to visualization
    sessionManager.onMessage((threadId, role, content, cost) => {
      visualizationServer?.getWsHandler().addToConversation(threadId, {
        id: Date.now().toString(),
        timestamp: Date.now(),
        role,
        content,
        cost,
      });
    });

    visualizationServer.start();
  } else if (config.visualization_enabled && !config.visualization_password) {
    console.warn("Visualization is enabled but no password is set. Skipping visualization server.");
  }
});

// Graceful shutdown
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\nShutting down gracefully...");

  // Shutdown visualization server
  if (visualizationServer) {
    visualizationServer.destroy();
  }

  try {
    await sessionManager.gracefulShutdown();
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
  }

  destroyConfigManager();
  closeMessageStore();
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.login(token);
