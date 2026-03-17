import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";

export type SessionMode = "action" | "plan" | "ask";

export function createModeSelect(currentMode: SessionMode) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("mode_select")
    .setPlaceholder(`Mode: ${getModeLabel(currentMode)}`)
    .addOptions([
      {
        label: "Plan",
        description: "Analyze and create a plan without making changes",
        value: "plan",
        default: currentMode === "plan",
      },
      {
        label: "Ask",
        description: "Answer questions without making changes",
        value: "ask",
        default: currentMode === "ask",
      },
      {
        label: "Action",
        description: "Execute tasks and make changes",
        value: "action",
        default: currentMode === "action",
      },
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  return row;
}

function getModeLabel(mode: SessionMode): string {
  switch (mode) {
    case "plan":
      return "Plan";
    case "ask":
      return "Ask";
    case "action":
      return "Action";
  }
}

export function getModeDescription(mode: SessionMode): string {
  switch (mode) {
    case "plan":
      return "Plan mode: Claude will analyze and create a plan without making changes.";
    case "ask":
      return "Ask mode: Claude will answer questions without making changes.";
    case "action":
      return "Action mode: Claude will execute tasks and make changes.";
  }
}
