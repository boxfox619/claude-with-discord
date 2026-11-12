import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";

// "default" 는 effort 를 넘기지 않고 모델/CLI 기본값을 쓴다.
export type EffortChoice = "default" | "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_OPTIONS: { value: EffortChoice; label: string; description: string }[] = [
  { value: "default", label: "Default", description: "모델 기본값 사용" },
  { value: "low", label: "Low", description: "빠르고 저렴. 단순 작업·서브에이전트" },
  { value: "medium", label: "Medium", description: "일상 코딩·대화" },
  { value: "high", label: "High", description: "어려운 코딩·리서치" },
  { value: "xhigh", label: "XHigh", description: "가장 어려운 장시간 작업 (토큰 많이 사용)" },
  { value: "max", label: "Max", description: "한계 측정용. 매우 느리고 비쌈" },
];

export function getEffortLabel(choice: EffortChoice): string {
  return EFFORT_OPTIONS.find((o) => o.value === choice)?.label ?? "Default";
}

export function isEffortChoice(value: string): value is EffortChoice {
  return EFFORT_OPTIONS.some((o) => o.value === value);
}

export function createEffortSelect(currentEffort: EffortChoice = "default") {
  const select = new StringSelectMenuBuilder()
    .setCustomId("effort_select")
    .setPlaceholder(`Effort: ${getEffortLabel(currentEffort)}`)
    .addOptions(
      EFFORT_OPTIONS.map((opt) => ({
        label: opt.label,
        description: opt.description,
        value: opt.value,
        default: opt.value === currentEffort,
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
