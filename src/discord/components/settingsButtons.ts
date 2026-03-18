import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { createProjectChannel, checkBotPermissions, sendPermissionError } from "../../services/settingsChannel.js";
import { getConfig } from "../../config.js";

/**
 * Handle settings button interactions
 */
export async function handleSettingsButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId === "settings:add_project") {
    await showAddProjectModal(interaction);
  } else if (customId === "settings:list_projects") {
    await showProjectList(interaction);
  }
}

/**
 * Show modal for adding a new project
 */
async function showAddProjectModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("settings:add_project_modal")
    .setTitle("Add New Project");

  const nameInput = new TextInputBuilder()
    .setCustomId("project_name")
    .setLabel("Project Name")
    .setPlaceholder("my-project")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const pathInput = new TextInputBuilder()
    .setCustomId("project_path")
    .setLabel("Project Path")
    .setPlaceholder("/home/user/projects/my-project")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const promptInput = new TextInputBuilder()
    .setCustomId("system_prompt")
    .setLabel("System Prompt (optional)")
    .setPlaceholder("You are an AI agent working on this project...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(pathInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(promptInput)
  );

  await interaction.showModal(modal);
}

/**
 * Show list of current projects
 */
async function showProjectList(interaction: ButtonInteraction): Promise<void> {
  const config = getConfig();
  const entries = Object.entries(config.channel_project_map);

  let description: string;
  if (entries.length === 0) {
    description = "_No projects configured yet._\n\nClick **Add Project** to create one!";
  } else {
    description = entries
      .map(([channelId, path]) => {
        const prompt = config.channel_system_prompts[channelId];
        const promptPreview = prompt
          ? `\n  └ _${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}_`
          : "";
        return `• <#${channelId}>\n  └ \`${path}\`${promptPreview}`;
      })
      .join("\n\n");
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋 Configured Projects")
    .setDescription(description)
    .setFooter({ text: `${entries.length} project(s) configured` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle add project modal submission
 */
export async function handleAddProjectModal(interaction: ModalSubmitInteraction): Promise<void> {
  const projectName = interaction.fields.getTextInputValue("project_name");
  const projectPath = interaction.fields.getTextInputValue("project_path");
  const systemPrompt = interaction.fields.getTextInputValue("system_prompt") || undefined;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check permissions first
  const { hasPermissions, missing } = checkBotPermissions(guild);
  if (!hasPermissions) {
    await interaction.reply({
      content: `❌ **Missing Permissions**\n\nI need the following permissions:\n${missing.map(p => `• ${p}`).join("\n")}`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const result = await createProjectChannel(guild, projectName, projectPath, systemPrompt);

  if (result.success) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("✅ Project Added")
      .setDescription(
        `Created channel <#${result.channelId}>\n\n` +
        `**Path:** \`${projectPath}\`\n` +
        `**Name:** ${projectName}`
      );

    await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("❌ Failed to Add Project")
      .setDescription(result.error || "Unknown error occurred");

    await interaction.editReply({ embeds: [embed] });
  }
}
