import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export function createSessionButtons(sessionCount: number = 0) {
  const newSessionButton = new ButtonBuilder()
    .setCustomId("new_session")
    .setLabel("New Session")
    .setStyle(ButtonStyle.Primary);

  const closeAllButton = new ButtonBuilder()
    .setCustomId("close_all_sessions")
    .setLabel(`Close All Sessions${sessionCount > 0 ? ` (${sessionCount})` : ''}`)
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    newSessionButton,
    closeAllButton
  );

  return row;
}
