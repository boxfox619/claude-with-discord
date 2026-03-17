import { interSessionBus } from '../../claude/interSessionBus.js';

interface AskParentInput {
  type: 'question' | 'approval_request';
  message: string;
  timeout_ms?: number;
}

interface AskParentOutput {
  success: boolean;
  approved?: boolean;
  response?: string;
  timeout?: boolean;
  error?: string;
}

/**
 * ask_parent 도구 정의 (서브세션 전용)
 */
export const askParentTool = {
  name: 'ask_parent',
  description: '부모 세션에 질문하거나 승인을 요청하고 응답을 기다립니다. 코드 변경 전 승인, 구현 방향 결정 등에 사용합니다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['question', 'approval_request'],
        description: '요청 유형: question(질문/결정 필요), approval_request(코드 변경 전 승인 요청)',
      },
      message: {
        type: 'string',
        description: '질문 또는 승인 요청 내용',
      },
      timeout_ms: {
        type: 'number',
        description: '응답 대기 타임아웃 (기본 5분)',
      },
    },
    required: ['type', 'message'],
  },
};

/**
 * ask_parent 실행
 */
export async function executeAskParent(
  input: AskParentInput,
  context: {
    subsessionThreadId: string;
    parentThreadId: string;
  }
): Promise<AskParentOutput> {
  const { type, message, timeout_ms = 300000 } = input;

  if (!type || !message) {
    return {
      success: false,
      error: 'type과 message는 필수입니다.',
    };
  }

  if (type !== 'question' && type !== 'approval_request') {
    return {
      success: false,
      error: "type은 'question' 또는 'approval_request'이어야 합니다.",
    };
  }

  try {
    const result = await interSessionBus.askParent(
      context.subsessionThreadId,
      context.parentThreadId,
      type,
      message,
      timeout_ms
    );

    if (result.timeout) {
      return {
        success: false,
        timeout: true,
        error: '응답 대기 시간이 초과되었습니다.',
      };
    }

    return {
      success: true,
      approved: result.approved,
      response: result.response,
      timeout: false,
    };
  } catch (error) {
    console.error('[askParent] Failed:', error);
    return {
      success: false,
      error: `질문/승인 요청 실패: ${(error as Error).message}`,
    };
  }
}
