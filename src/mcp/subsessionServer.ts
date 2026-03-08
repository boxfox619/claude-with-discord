/**
 * Subsession MCP Server
 *
 * 서브세션 시스템을 위한 MCP 도구들을 관리합니다.
 * 세션 유형(메인/서브)에 따라 사용 가능한 도구가 다릅니다.
 */

import type { Client } from 'discord.js';
import type { SubsessionContext, SubsessionState, SessionInfo } from '../types.js';
import { isSubsession, isMainSession } from '../types.js';

import {
  mainSessionTools,
  subsessionTools,
  executeCreateSubsession,
  executeDelegateToSubsession,
  executeCheckSubsessionStatus,
  executeCloseSubsession,
  executeRespondToSubsession,
  executeNotifyParent,
  executeAskParent,
  executeUpdateProgress,
  executeListSubsessions,
} from './tools/index.js';

interface SubsessionServerConfig {
  discordClient: Client;
  getSession: (threadId: string) => SessionInfo | undefined;
  onSubsessionCreated: (state: SubsessionState, description: string, context?: SubsessionContext) => Promise<void>;
  onSubsessionClosed: (threadId: string) => Promise<void>;
}

/**
 * SubsessionServer 클래스
 */
export class SubsessionServer {
  private config: SubsessionServerConfig;

  constructor(config: SubsessionServerConfig) {
    this.config = config;
  }

  /**
   * 세션 유형에 따른 사용 가능한 도구 목록 반환
   */
  getAvailableTools(session: SessionInfo): typeof mainSessionTools | typeof subsessionTools {
    if (isSubsession(session)) {
      return subsessionTools;
    }
    return mainSessionTools;
  }

  /**
   * 도구 실행
   */
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    session: SessionInfo
  ): Promise<{ success: boolean; result: unknown }> {
    try {
      // 메인 세션 전용 도구
      if (isMainSession(session)) {
        switch (toolName) {
          case 'create_subsession': {
            const result = await executeCreateSubsession(
              input as { alias: string; description: string; context?: SubsessionContext },
              {
                parentThreadId: session.threadId,
                channelId: session.channelId,
                threadName: `Session-${session.sessionId.slice(0, 8)}`,
                getNextSubsessionId: () => session.nextSubsessionId++,
                projectPath: session.projectPath,
                onSubsessionCreated: this.config.onSubsessionCreated,
              }
            );
            return { success: result.success, result };
          }

          case 'delegate_to_subsession': {
            const result = await executeDelegateToSubsession(
              input as { targetId?: number; targetAlias?: string; task: string; check_after_ms?: number },
              { parentThreadId: session.threadId }
            );
            return { success: result.success, result };
          }

          case 'check_subsession_status': {
            const result = executeCheckSubsessionStatus(
              input as { id?: number; alias?: string }
            );
            return { success: result.success, result };
          }

          case 'close_subsession': {
            const result = await executeCloseSubsession(
              input as { id?: number; alias?: string; archive_thread?: boolean },
              {
                discordClient: this.config.discordClient,
                onSubsessionClosed: this.config.onSubsessionClosed,
              }
            );
            return { success: result.success, result };
          }

          case 'respond_to_subsession': {
            const result = executeRespondToSubsession(
              input as { requestId: string; approved?: boolean; response: string }
            );
            return { success: result.success, result };
          }

          case 'list_subsessions': {
            const result = executeListSubsessions();
            return { success: result.success, result };
          }
        }
      }

      // 서브세션 전용 도구
      if (isSubsession(session)) {
        switch (toolName) {
          case 'notify_parent': {
            const result = await executeNotifyParent(
              input as { type: 'info' | 'warning'; message: string },
              {
                subsessionThreadId: session.threadId,
                parentThreadId: session.parentThreadId,
              }
            );
            return { success: result.success, result };
          }

          case 'ask_parent': {
            const result = await executeAskParent(
              input as { type: 'question' | 'approval_request'; message: string; timeout_ms?: number },
              {
                subsessionThreadId: session.threadId,
                parentThreadId: session.parentThreadId,
              }
            );
            return { success: result.success, result };
          }

          case 'update_progress': {
            const result = executeUpdateProgress(
              input as { progress: string },
              { subsessionThreadId: session.threadId }
            );
            return { success: result.success, result };
          }

          case 'list_subsessions': {
            const result = executeListSubsessions();
            return { success: result.success, result };
          }
        }
      }

      return {
        success: false,
        result: { error: `Unknown tool or not available for this session type: ${toolName}` },
      };
    } catch (error) {
      console.error(`[SubsessionServer] Tool execution failed: ${toolName}`, error);
      return {
        success: false,
        result: { error: `Tool execution failed: ${(error as Error).message}` },
      };
    }
  }

  /**
   * 도구가 서브세션 관련인지 확인
   */
  isSubsessionTool(toolName: string): boolean {
    const allTools = [
      'create_subsession',
      'delegate_to_subsession',
      'check_subsession_status',
      'close_subsession',
      'respond_to_subsession',
      'notify_parent',
      'ask_parent',
      'update_progress',
      'list_subsessions',
    ];
    return allTools.includes(toolName);
  }
}

// 싱글톤 인스턴스
let subsessionServer: SubsessionServer | null = null;

/**
 * SubsessionServer 초기화
 */
export function initSubsessionServer(config: SubsessionServerConfig): SubsessionServer {
  subsessionServer = new SubsessionServer(config);
  return subsessionServer;
}

/**
 * SubsessionServer 인스턴스 가져오기
 */
export function getSubsessionServer(): SubsessionServer {
  if (!subsessionServer) {
    throw new Error('SubsessionServer not initialized. Call initSubsessionServer first.');
  }
  return subsessionServer;
}

export { subsessionServer };
