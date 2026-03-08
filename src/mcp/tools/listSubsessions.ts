import { interSessionBus } from '../../claude/interSessionBus.js';
import type { SubsessionStatus } from '../../types.js';

interface SubsessionInfo {
  id: number;
  alias: string;
  status: SubsessionStatus;
  threadId: string;
  assignedPaths?: string[];
  progress?: string;
}

interface ListSubsessionsOutput {
  success: boolean;
  subsessions: SubsessionInfo[];
}

/**
 * list_subsessions 도구 정의 (공통)
 */
export const listSubsessionsTool = {
  name: 'list_subsessions',
  description: '현재 활성화된 모든 서브세션 목록과 상태를 확인합니다.',
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

/**
 * list_subsessions 실행
 */
export function executeListSubsessions(): ListSubsessionsOutput {
  const allSubsessions = interSessionBus.getAllSubsessions();

  const subsessions: SubsessionInfo[] = allSubsessions.map((s) => ({
    id: s.id,
    alias: s.alias,
    status: s.status,
    threadId: s.threadId,
    assignedPaths: s.assignedPaths,
    progress: s.progress,
  }));

  return {
    success: true,
    subsessions,
  };
}
