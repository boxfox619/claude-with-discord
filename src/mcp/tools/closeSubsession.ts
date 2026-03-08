import { interSessionBus } from '../../claude/interSessionBus.js';
import type { Client, ThreadChannel } from 'discord.js';

interface CloseSubsessionInput {
  id?: number;
  alias?: string;
  archive_thread?: boolean;
}

interface CloseSubsessionOutput {
  success: boolean;
  message: string;
}

/**
 * close_subsession 도구 정의
 */
export const closeSubsessionTool = {
  name: 'close_subsession',
  description: '서브세션을 종료합니다.',
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
      archive_thread: {
        type: 'boolean',
        description: 'Discord 스레드 아카이브 여부 (기본: true)',
      },
    },
  },
};

/**
 * close_subsession 실행
 */
export async function executeCloseSubsession(
  input: CloseSubsessionInput,
  context: {
    discordClient: Client;
    onSubsessionClosed: (threadId: string) => Promise<void>;
  }
): Promise<CloseSubsessionOutput> {
  const { id, alias, archive_thread = true } = input;

  // id 또는 alias 중 하나는 필수
  if (id === undefined && !alias) {
    return {
      success: false,
      message: 'id 또는 alias 중 하나를 지정해야 합니다.',
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
      message: '서브세션을 찾을 수 없습니다.',
    };
  }

  try {
    // Discord 스레드 아카이브
    if (archive_thread) {
      try {
        const thread = await context.discordClient.channels.fetch(subsession.threadId) as ThreadChannel;
        if (thread && 'setArchived' in thread) {
          await thread.setArchived(true, '서브세션 종료');
        }
      } catch (error) {
        console.warn(`[closeSubsession] Failed to archive thread: ${error}`);
      }
    }

    // 세션 정리 콜백
    await context.onSubsessionClosed(subsession.threadId);

    // InterSessionBus에서 제거
    interSessionBus.cleanup(subsession.threadId);

    return {
      success: true,
      message: `서브세션 '${subsession.alias}' (ID: ${subsession.id})가 종료되었습니다.`,
    };
  } catch (error) {
    console.error('[closeSubsession] Failed:', error);
    return {
      success: false,
      message: `서브세션 종료 실패: ${(error as Error).message}`,
    };
  }
}
