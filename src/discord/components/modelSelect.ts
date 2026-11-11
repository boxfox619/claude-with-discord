import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";

export type ModelChoice = "opus" | "fable" | "sonnet" | "haiku";

// modelId 는 Claude Code CLI 별칭이다. CLI 가 최신 버전으로 풀어 주므로
// 새 모델이 나와도 여기를 고칠 필요가 없다 (목록은 query.supportedModels() 와 맞출 것).
export const MODEL_OPTIONS: { value: ModelChoice; label: string; description: string; modelId: string }[] = [
  {
    value: "opus",
    label: "Claude Opus",
    description: "For complex work and everyday tasks",
    modelId: "opus",
  },
  {
    value: "fable",
    label: "Claude Fable",
    description: "For your toughest challenges",
    modelId: "fable",
  },
  {
    value: "sonnet",
    label: "Claude Sonnet",
    description: "Most efficient for simpler tasks",
    modelId: "sonnet",
  },
  {
    value: "haiku",
    label: "Claude Haiku",
    description: "Fastest for quick answers",
    modelId: "haiku",
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
