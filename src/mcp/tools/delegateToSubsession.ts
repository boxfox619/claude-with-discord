import { interSessionBus } from '../../claude/interSessionBus.js';
import { SUBSESSION_LIMITS } from '../../types.js';

interface DelegateToSubsessionInput {
  targetId?: number;
  targetAlias?: string;
  task: string;
  check_after_ms?: number;
}

interface DelegateToSubsessionOutput {
  success: boolean;
  taskId?: string;
  message: string;
}

/**
 * delegate_to_subsession 도구 정의
 */
export const delegateToSubsessionTool = {
  name: 'delegate_to_subsession',
  description: '서브세션에 작업을 위임합니다. 결과는 완료 시 자동으로 전달됩니다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      targetId: {
        type: 'number',
        description: '대상 서브세션의 숫자 ID',
      },
      targetAlias: {
        type: 'string',
        description: '대상 서브세션의 alias',
      },
      task: {
        type: 'string',
        description: '위임할 작업',
      },
      check_after_ms: {
        type: 'number',
        description: '이 시간 후에도 결과 없으면 상태 체크 알림 (기본 2분)',
      },
    },
    required: ['task'],
  },
};

/**
 * delegate_to_subsession 실행
 */
export async function executeDelegateToSubsession(
  input: DelegateToSubsessionInput,
  context: {
    parentThreadId: string;
  }
): Promise<DelegateToSubsessionOutput> {
  const { targetId, targetAlias, task, check_after_ms } = input;

  // targetId 또는 targetAlias 중 하나는 필수
  if (targetId === undefined && !targetAlias) {
    return {
      success: false,
      message: 'targetId 또는 targetAlias 중 하나를 지정해야 합니다.',
    };
  }

  // 타겟 확인
  const target: { id?: number; alias?: string } = {};
  if (targetId !== undefined) {
    target.id = targetId;
    const subsession = interSessionBus.findSubsessionById(targetId);
    if (!subsession) {
      return {
        success: false,
        message: `ID ${targetId}인 서브세션을 찾을 수 없습니다.`,
      };
    }
  } else if (targetAlias) {
    target.alias = targetAlias;
    const subsession = interSessionBus.findSubsessionByAlias(targetAlias);
    if (!subsession) {
      return {
        success: false,
        message: `alias '${targetAlias}'인 서브세션을 찾을 수 없습니다.`,
      };
    }
  }

  // 작업 위임
  const result = await interSessionBus.delegateTask(
    context.parentThreadId,
    target,
    task,
    check_after_ms ?? SUBSESSION_LIMITS.DEFAULT_CHECK_AFTER_MS
  );

  return result;
}
