import { interSessionBus } from '../../claude/interSessionBus.js';
import type { SubsessionStatus } from '../../types.js';

interface CheckSubsessionStatusInput {
  id?: number;
  alias?: string;
}

interface CheckSubsessionStatusOutput {
  success: boolean;
  id?: number;
  alias?: string;
  status?: SubsessionStatus;
  progress?: string;
  lastResult?: string;
  lastError?: string;
  error?: string;
}

/**
 * check_subsession_status 도구 정의
 */
export const checkSubsessionStatusTool = {
  name: 'check_subsession_status',
  description: '서브세션의 현재 상태를 확인합니다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'number',
        description: '서브세션의 숫자 ID',
      },
      alias: {
        type: 'string',
        description: '서브세션의 alias',
      },
    },
  },
};

/**
 * check_subsession_status 실행
 */
export function executeCheckSubsessionStatus(
  input: CheckSubsessionStatusInput
): CheckSubsessionStatusOutput {
  const { id, alias } = input;

  // id 또는 alias 중 하나는 필수
  if (id === undefined && !alias) {
    return {
      success: false,
      error: 'id 또는 alias 중 하나를 지정해야 합니다.',
    };
  }

  // 서브세션 찾기
  let subsession;
  if (id !== undefined) {
    subsession = interSessionBus.findSubsessionById(id);
  } else if (alias) {
    subsession = interSessionBus.findSubsessionByAlias(alias);
  }

  if (!subsession) {
    return {
      success: false,
      error: '서브세션을 찾을 수 없습니다.',
    };
  }

  return {
    success: true,
    id: subsession.id,
    alias: subsession.alias,
    status: subsession.status,
    progress: subsession.progress,
    lastResult: subsession.lastResult,
    lastError: subsession.lastError,
  };
}
