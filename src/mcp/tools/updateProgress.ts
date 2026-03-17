import { interSessionBus } from '../../claude/interSessionBus.js';

interface UpdateProgressInput {
  progress: string;
}

interface UpdateProgressOutput {
  success: boolean;
  message: string;
}

/**
 * update_progress 도구 정의 (서브세션 전용)
 */
export const updateProgressTool = {
  name: 'update_progress',
  description: '현재 작업 진행 상황을 업데이트합니다. 긴 작업 시 주기적으로 호출하면 부모 세션이 상태를 파악할 수 있습니다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      progress: {
        type: 'string',
        description: "현재 진행 상황 (예: '파일 50/100개 분석 완료')",
      },
    },
    required: ['progress'],
  },
};

/**
 * update_progress 실행
 */
export function executeUpdateProgress(
  input: UpdateProgressInput,
  context: {
    subsessionThreadId: string;
  }
): UpdateProgressOutput {
  const { progress } = input;

  if (!progress) {
    return {
      success: false,
      message: 'progress는 필수입니다.',
    };
  }

  interSessionBus.updateProgress(context.subsessionThreadId, progress);

  return {
    success: true,
    message: '진행 상황이 업데이트되었습니다.',
  };
}
