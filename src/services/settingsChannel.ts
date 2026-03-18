import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type TextChannel,
  type CategoryChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig, reloadConfig } from "../config.js";

const SETTINGS_CHANNEL_NAME = "claude-settings";
const CATEGORY_NAME = "Claude Code";
const CONFIG_PATH = resolve(process.cwd(), "config.json");

// Store settings channel ID per guild
const settingsChannels = new Map<string, string>();

/**
 * Check if bot has required permissions in a guild
 */
export function checkBotPermissions(guild: Guild): { hasPermissions: boolean; missing: string[] } {
  const botMember = guild.members.me;
  if (!botMember) {
    return { hasPermissions: false, missing: ["Bot not in guild"] };
  }

  const missing: string[] = [];

  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
    missing.push("Manage Channels");
  }
  if (!botMember.permissions.has(PermissionFlagsBits.SendMessages)) {
    missing.push("Send Messages");
  }
  if (!botMember.permissions.has(PermissionFlagsBits.CreatePublicThreads)) {
    missing.push("Create Public Threads");
  }

  return {
    hasPermissions: missing.length === 0,
    missing,
  };
}

/**
 * Send a permission error message to a channel
 */
export async function sendPermissionError(channel: TextChannel, missing: string[]): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("❌ Missing Permissions")
    .setDescription(
      "I need the following permissions to work properly:\n\n" +
      missing.map(p => `• **${p}**`).join("\n") +
      "\n\nPlease ask a server admin to grant these permissions."
    );

  await channel.send({ embeds: [embed] });
}

/**
 * Find or create the Claude Code category
 */
async function findOrCreateCategory(guild: Guild): Promise<CategoryChannel | null> {
  const { hasPermissions, missing } = checkBotPermissions(guild);
  if (!hasPermissions) {
    console.error(`Missing permissions in guild ${guild.name}: ${missing.join(", ")}`);
    return null;
  }

  // Find existing category
  const existingCategory = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === CATEGORY_NAME
  ) as CategoryChannel | undefined;

  if (existingCategory) {
    return existingCategory;
  }

  // Create new category
  try {
    const category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
    });
    console.log(`Created category "${CATEGORY_NAME}" in guild ${guild.name}`);
    return category;
  } catch (error) {
    console.error(`Failed to create category in guild ${guild.name}:`, error);
    return null;
  }
}

/**
 * Find or create the settings channel in a guild
 */
async function findOrCreateSettingsChannel(guild: Guild): Promise<TextChannel | null> {
  const { hasPermissions, missing } = checkBotPermissions(guild);
  if (!hasPermissions) {
    console.error(`Missing permissions in guild ${guild.name}: ${missing.join(", ")}`);
    return null;
  }

  // Find existing settings channel
  const existingChannel = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === SETTINGS_CHANNEL_NAME
  ) as TextChannel | undefined;

  if (existingChannel) {
    settingsChannels.set(guild.id, existingChannel.id);
    return existingChannel;
  }

  // Get or create category
  const category = await findOrCreateCategory(guild);

  // Create settings channel
  try {
    const channel = await guild.channels.create({
      name: SETTINGS_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category?.id,
      topic: "Claude Code Bot settings and project management",
    });

    settingsChannels.set(guild.id, channel.id);
    console.log(`Created settings channel in guild ${guild.name}`);

    // Send welcome message
    await sendWelcomeMessage(channel);

    return channel;
  } catch (error) {
    console.error(`Failed to create settings channel in guild ${guild.name}:`, error);
    return null;
  }
}

/**
 * Send welcome message to settings channel
 */
async function sendWelcomeMessage(channel: TextChannel): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🤖 Claude Code Bot")
    .setDescription(
      "Welcome! This channel is for managing Claude Code projects.\n\n" +
      "**Commands:**\n" +
      "• Click **Add Project** to create a new project channel\n" +
      "• Each project gets its own channel linked to a directory\n\n" +
      "**Current Projects:**\n" +
      getProjectList()
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("settings:add_project")
      .setLabel("Add Project")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("➕"),
    new ButtonBuilder()
      .setCustomId("settings:list_projects")
      .setLabel("List Projects")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📋"),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

/**
 * Get formatted list of current projects
 */
function getProjectList(): string {
  const config = getConfig();
  const entries = Object.entries(config.channel_project_map);

  if (entries.length === 0) {
    return "_No projects configured yet_";
  }

  return entries
    .map(([channelId, path]) => `• <#${channelId}> → \`${path}\``)
    .join("\n");
}

/**
 * Create a new project channel
 */
export async function createProjectChannel(
  guild: Guild,
  projectName: string,
  projectPath: string,
  systemPrompt?: string
): Promise<{ success: boolean; channelId?: string; error?: string }> {
  const { hasPermissions, missing } = checkBotPermissions(guild);
  if (!hasPermissions) {
    return {
      success: false,
      error: `Missing permissions: ${missing.join(", ")}`,
    };
  }

  // Sanitize channel name
  const channelName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 100);

  // Get or create category
  const category = await findOrCreateCategory(guild);

  try {
    // Create the channel
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id,
      topic: `Claude Code project: ${projectPath}`,
    });

    // Update config.json
    const configPath = CONFIG_PATH;
    let config: Record<string, unknown> = {};

    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    }

    // Initialize maps if they don't exist
    if (!config.channel_project_map) config.channel_project_map = {};
    if (!config.channel_system_prompts) config.channel_system_prompts = {};

    // Add new channel mapping
    (config.channel_project_map as Record<string, string>)[channel.id] = projectPath;
    (config.channel_system_prompts as Record<string, string>)[channel.id] =
      systemPrompt || `You are an AI agent working on the ${projectName} project.\n\nProject path: ${projectPath}`;

    // Write updated config
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Reload config to apply changes
    reloadConfig();

    // Send confirmation in new channel
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`✅ Project Channel Created`)
      .setDescription(
        `This channel is now linked to:\n\`${projectPath}\`\n\n` +
        "Send a message to start a Claude Code session!"
      );

    await channel.send({ embeds: [embed] });

    return { success: true, channelId: channel.id };
  } catch (error) {
    console.error(`Failed to create project channel:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Initialize settings channels for all guilds
 */
export async function initializeSettingsChannels(client: Client): Promise<void> {
  console.log("Initializing settings channels...");

  for (const guild of client.guilds.cache.values()) {
    const { hasPermissions, missing } = checkBotPermissions(guild);

    if (!hasPermissions) {
      console.warn(
        `⚠️  Missing permissions in "${guild.name}": ${missing.join(", ")}\n` +
        `   Please grant these permissions for full functionality.`
      );
      continue;
    }

    await findOrCreateSettingsChannel(guild);
  }
}

/**
 * Check if a channel is a settings channel
 */
export function isSettingsChannel(channelId: string): boolean {
  for (const settingsId of settingsChannels.values()) {
    if (settingsId === channelId) return true;
  }
  return false;
}

/**
 * Get settings channel ID for a guild
 */
export function getSettingsChannelId(guildId: string): string | undefined {
  return settingsChannels.get(guildId);
}
