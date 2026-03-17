import type { SubsessionContext, SubsessionState } from '../../types.js';
import { SUBSESSION_LIMITS, ALIAS_RULES } from '../../types.js';
import { interSessionBus } from '../../claude/interSessionBus.js';
import { getThreadCreationQueue } from '../../discord/threadCreationQueue.js';

interface CreateSubsessionInput {
  alias: string;
  description: string;
  context?: SubsessionContext;
}

interface CreateSubsessionOutput {
  success: boolean;
  id?: number;
  alias?: string;
  threadId?: string;
  error?: string;
}

/**
 * create_subsession 도구 정의
 */
export const createSubsessionTool = {
  name: 'create_subsession',
  description: '서브세션을 생성합니다. 서브세션은 독립된 Discord 스레드에서 실행되며, 컨텍스트를 유지합니다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      alias: {
        type: 'string',
        description: '서브세션 식별자 (고유, 영문 소문자/숫자/하이픈, 예: code-analyst)',
      },
      description: {
        type: 'string',
        description: '서브세션의 역할과 지침 (시스템 프롬프트에 포함됨)',
      },
      context: {
        type: 'object',
        description: '초기 컨텍스트 (선택)',
        properties: {
          relevant_files: {
            type: 'array',
            items: { type: 'string' },
            description: '관련 파일 경로 목록',
          },
          background: {
            type: 'string',
            description: '배경 정보',
          },
          constraints: {
            type: 'array',
            items: { type: 'string' },
            description: '제약 조건 목록',
          },
        },
      },
    },
    required: ['alias', 'description'],
  },
};

/**
 * alias 유효성 검사
 */
function validateAlias(alias: string): { valid: boolean; error?: string } {
  if (!ALIAS_RULES.pattern.test(alias)) {
    return {
      valid: false,
      error: `alias는 영문 소문자로 시작하고, 소문자/숫자/하이픈만 포함해야 합니다 (최대 ${ALIAS_RULES.maxLength}자)`,
    };
  }

  if ((ALIAS_RULES.reserved as readonly string[]).includes(alias)) {
    return {
      valid: false,
      error: `'${alias}'는 예약어입니다. 다른 이름을 사용하세요.`,
    };
  }

  // 중복 검사
  if (interSessionBus.findSubsessionByAlias(alias)) {
    return {
      valid: false,
      error: `'${alias}' alias는 이미 사용 중입니다.`,
    };
  }

  return { valid: true };
}

/**
 * create_subsession 실행
 */
export async function executeCreateSubsession(
  input: CreateSubsessionInput,
  context: {
    parentThreadId: string;
    channelId: string;
    threadName: string;
    getNextSubsessionId: () => number;
    projectPath: string;
    onSubsessionCreated: (state: SubsessionState, description: string, context?: SubsessionContext) => Promise<void>;
  }
): Promise<CreateSubsessionOutput> {
  const { alias, description, context: subsessionContext } = input;

  // alias 유효성 검사
  const validation = validateAlias(alias);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // 서브세션 수 제한 확인
  const allSubsessions = interSessionBus.getAllSubsessions();
  if (allSubsessions.length >= SUBSESSION_LIMITS.MAX_TOTAL_SUBSESSIONS) {
    return { success: false, error: '전체 서브세션 수가 최대치에 도달했습니다.' };
  }

  // 해당 메인 세션의 서브세션 수 확인
  const childCount = allSubsessions.filter((s) => {
    // parentThreadId 기준으로 필터 (추후 확장)
    return true;
  }).length;

  if (childCount >= SUBSESSION_LIMITS.MAX_SUBSESSIONS_PER_SESSION) {
    return { success: false, error: '이 세션의 서브세션 수가 최대치에 도달했습니다.' };
  }

  try {
    // Discord 스레드 생성
    const threadQueue = getThreadCreationQueue();
    const threadName = `[Sub:${alias}] ${context.threadName}`.slice(0, 100);

    const thread = await threadQueue.createThread(context.channelId, threadName, {
      autoArchiveDuration: 1440, // 24시간
      reason: `Subsession created: ${alias}`,
    });

    // 서브세션 ID 발급
    const subsessionId = context.getNextSubsessionId();

    // SubsessionState 생성
    const state: SubsessionState = {
      id: subsessionId,
      alias,
      threadId: thread.id,
      status: 'idle',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      assignedPaths: subsessionContext?.relevant_files,
    };

    // InterSessionBus에 등록
    interSessionBus.registerSubsession(state);

    // 콜백 호출 (sessionManager에서 실제 Claude 세션 생성)
    await context.onSubsessionCreated(state, description, subsessionContext);

    return {
      success: true,
      id: subsessionId,
      alias,
      threadId: thread.id,
    };
  } catch (error) {
    console.error('[createSubsession] Failed:', error);
    return {
      success: false,
      error: `서브세션 생성 실패: ${(error as Error).message}`,
    };
  }
}
