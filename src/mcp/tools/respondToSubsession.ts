import { interSessionBus } from '../../claude/interSessionBus.js';

interface RespondToSubsessionInput {
  requestId: string;
  approved?: boolean;
  response: string;
}

interface RespondToSubsessionOutput {
  success: boolean;
  message: string;
}

/**
 * respond_to_subsession 도구 정의 (메인 세션 전용, 내부)
 */
export const respondToSubsessionTool = {
  name: 'respond_to_subsession',
  description: '서브세션의 ask_parent 요청에 응답합니다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      requestId: {
        type: 'string',
        description: '요청 ID',
      },
      approved: {
        type: 'boolean',
        description: '승인 여부 (approval_request인 경우)',
      },
      response: {
        type: 'string',
        description: '응답 내용',
      },
    },
    required: ['requestId', 'response'],
  },
};

/**
 * respond_to_subsession 실행
 */
export function executeRespondToSubsession(
  input: RespondToSubsessionInput
): RespondToSubsessionOutput {
  const { requestId, approved, response } = input;

  if (!requestId || !response) {
    return {
      success: false,
      message: 'requestId와 response는 필수입니다.',
    };
  }

  const result = interSessionBus.respondToSubsession(requestId, approved, response);
  return result;
}
