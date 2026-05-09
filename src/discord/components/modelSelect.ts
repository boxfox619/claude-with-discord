import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";

export type ModelChoice = "opus" | "sonnet" | "haiku";

export const MODEL_OPTIONS: { value: ModelChoice; label: string; description: string; modelId: string }[] = [
  {
    value: "opus",
    label: "Claude Opus",
    description: "Most capable, highest quality",
    modelId: "claude-opus-4-6",
  },
  {
    value: "sonnet",
    label: "Claude Sonnet",
    description: "Balanced performance and speed",
    modelId: "claude-sonnet-4-6",
  },
  {
    value: "haiku",
    label: "Claude Haiku",
    description: "Fastest, most cost-effective",
    modelId: "claude-haiku-4-5-20251001",
  },
];

export function getModelId(choice: ModelChoice): string {
  return MODEL_OPTIONS.find((o) => o.value === choice)?.modelId ?? MODEL_OPTIONS[0].modelId;
}

export function getModelLabel(choice: ModelChoice): string {
  return MODEL_OPTIONS.find((o) => o.value === choice)?.label ?? "Claude Opus";
}

export function getModelChoiceFromId(modelId: string): ModelChoice {
  return MODEL_OPTIONS.find((o) => o.modelId === modelId)?.value ?? "opus";
}

export function createModelSelect(currentModel: ModelChoice = "opus") {
  const select = new StringSelectMenuBuilder()
    .setCustomId("model_select")
    .setPlaceholder(`Model: ${getModelLabel(currentModel)}`)
    .addOptions(
      MODEL_OPTIONS.map((opt) => ({
        label: opt.label,
        description: opt.description,
        value: opt.value,
        default: opt.value === currentModel,
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
