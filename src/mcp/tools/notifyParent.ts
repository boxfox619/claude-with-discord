import { interSessionBus } from '../../claude/interSessionBus.js';

interface NotifyParentInput {
  type: 'info' | 'warning';
  message: string;
}

interface NotifyParentOutput {
  success: boolean;
  message: string;
}

/**
 * notify_parent 도구 정의 (서브세션 전용)
 */
export const notifyParentTool = {
  name: 'notify_parent',
  description: '부모 세션에 단방향 알림을 보냅니다. 응답이 필요 없는 정보 전달에만 사용합니다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['info', 'warning'],
        description: '알림 유형: info(일반 정보, 진행 상황), warning(주의 필요한 발견)',
      },
      message: {
        type: 'string',
        description: '알림 내용',
      },
    },
    required: ['type', 'message'],
  },
};

/**
 * notify_parent 실행
 */
export async function executeNotifyParent(
  input: NotifyParentInput,
  context: {
    subsessionThreadId: string;
    parentThreadId: string;
  }
): Promise<NotifyParentOutput> {
  const { type, message } = input;

  if (!type || !message) {
    return {
      success: false,
      message: 'type과 message는 필수입니다.',
    };
  }

  if (type !== 'info' && type !== 'warning') {
    return {
      success: false,
      message: "type은 'info' 또는 'warning'이어야 합니다.",
    };
  }

  try {
    await interSessionBus.notifyParent(
      context.subsessionThreadId,
      context.parentThreadId,
      type,
      message
    );

    return {
      success: true,
      message: '알림이 전송되었습니다.',
    };
  } catch (error) {
    console.error('[notifyParent] Failed:', error);
    return {
      success: false,
      message: `알림 전송 실패: ${(error as Error).message}`,
    };
  }
}
