/**
 * Stateful Agent MCP Server (In-Memory)
 *
 * Claude Agent SDK의 mcpServers 옵션에 직접 전달되는 인메모리 MCP 서버입니다.
 * 별도 프로세스 없이 같은 프로세스에서 실행되어 메모리를 공유합니다.
 *
 * "Stateful Agent"는 컨텍스트를 유지하는 독립 에이전트입니다.
 * (기존 "subsession" 용어를 대체)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Client } from 'discord.js';
import type { SessionInfo, SubsessionContext, SubsessionState } from '../types.js';
import { isSubsession, isMainSession } from '../types.js';
import { interSessionBus } from '../claude/interSessionBus.js';
import { getThreadCreationQueue } from '../discord/threadCreationQueue.js';
import { SUBSESSION_LIMITS, ALIAS_RULES } from '../types.js';

// ============================================
// Types
// ============================================

interface SubsessionMcpServerConfig {
  discordClient: Client;
  getSession: (threadId: string) => SessionInfo | undefined;
  onSubsessionCreated: (state: SubsessionState, description: string, parentThreadId: string, context?: SubsessionContext) => Promise<void>;
  onSubsessionClosed: (threadId: string) => Promise<void>;
}

// 현재 실행 컨텍스트 (도구 호출 시 설정됨)
interface ExecutionContext {
  threadId: string;
  session: SessionInfo;
}

// ============================================
// MCP Server Factory
// ============================================

/**
 * 메인 세션용 MCP 서버 생성
 */
export function createMainSessionMcpServer(
  config: SubsessionMcpServerConfig,
  context: ExecutionContext
): McpServer {
  const server = new McpServer({
    name: 'stateful-agent-main',
    version: '1.0.0',
  });

  const { session } = context;
  if (!isMainSession(session)) {
    throw new Error('Expected main session');
  }

  // ----------------------------------------
  // create_stateful_agent
  // ----------------------------------------
  server.tool(
    'create_stateful_agent',
    'Stateful Agent를 생성합니다. 독립된 Discord 스레드에서 실행되며, 컨텍스트를 유지하는 에이전트입니다.',
    {
      alias: z.string().describe('에이전트 식별자 (고유, 영문 소문자/숫자/하이픈)'),
      description: z.string().describe('에이전트의 역할과 지침'),
      context: z.object({
        relevant_files: z.array(z.string()).optional().describe('관련 파일 경로 목록'),
        background: z.string().optional().describe('배경 정보'),
        constraints: z.array(z.string()).optional().describe('제약 조건 목록'),
      }).optional().describe('초기 컨텍스트'),
    },
    async (args) => {
      const { alias, description, context: subsessionContext } = args;

      // alias 유효성 검사
      if (!ALIAS_RULES.pattern.test(alias)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: `alias는 영문 소문자로 시작하고, 소문자/숫자/하이픈만 포함해야 합니다 (최대 ${ALIAS_RULES.maxLength}자)`,
          }) }],
        };
      }

      if ((ALIAS_RULES.reserved as readonly string[]).includes(alias)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: `'${alias}'는 예약어입니다. 다른 이름을 사용하세요.`,
          }) }],
        };
      }

      if (interSessionBus.findSubsessionByAlias(alias)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: `'${alias}' alias는 이미 사용 중입니다.`,
          }) }],
        };
      }

      // 에이전트 수 제한 확인
      const allSubsessions = interSessionBus.getAllSubsessions();
      if (allSubsessions.length >= SUBSESSION_LIMITS.MAX_TOTAL_SUBSESSIONS) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: '전체 Stateful Agent 수가 최대치에 도달했습니다.',
          }) }],
        };
      }

      try {
        // Discord 스레드 생성
        const threadQueue = getThreadCreationQueue();
        const threadName = `[Agent:${alias}]`.slice(0, 100);

        const thread = await threadQueue.createThread(session.channelId, threadName, {
          autoArchiveDuration: 1440,
          reason: `Stateful Agent created: ${alias}`,
        });

        // 에이전트 ID 발급
        const subsessionId = session.nextSubsessionId++;

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

        // 콜백 호출 (부모 threadId 전달)
        await config.onSubsessionCreated(state, description, session.threadId, subsessionContext);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            id: subsessionId,
            alias,
            threadId: thread.id,
            message: `Stateful Agent '${alias}' (ID: ${subsessionId})가 생성되었습니다.`,
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: `Stateful Agent 생성 실패: ${(error as Error).message}`,
          }) }],
        };
      }
    }
  );

  // ----------------------------------------
  // delegate_task
  // ----------------------------------------
  server.tool(
    'delegate_task',
    `Stateful Agent에 작업을 위임합니다.

**중요**: 이 도구는 즉시 반환됩니다. 작업 위임 후 다른 작업을 계속 진행하세요.
에이전트가 완료되면 "[에이전트 메시지: alias]" 형식의 새 메시지가 자동으로 도착합니다.
check_agent_status로 폴링하지 마세요.`,
    {
      targetId: z.number().optional().describe('대상 에이전트의 숫자 ID'),
      targetAlias: z.string().optional().describe('대상 에이전트의 alias'),
      task: z.string().describe('위임할 작업'),
      check_after_ms: z.number().optional().describe('상태 체크 타임아웃 (기본 2분)'),
    },
    async (args) => {
      const { targetId, targetAlias, task, check_after_ms } = args;

      if (targetId === undefined && !targetAlias) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            message: 'targetId 또는 targetAlias 중 하나를 지정해야 합니다.',
          }) }],
        };
      }

      const result = await interSessionBus.delegateTask(
        session.threadId,
        { id: targetId, alias: targetAlias },
        task,
        check_after_ms ?? SUBSESSION_LIMITS.DEFAULT_CHECK_AFTER_MS
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  // ----------------------------------------
  // check_agent_status
  // ----------------------------------------
  server.tool(
    'check_agent_status',
    `Stateful Agent의 현재 상태를 확인합니다.

**주의**: 에이전트 결과를 기다리기 위해 이 도구를 반복 호출(폴링)하지 마세요.
에이전트가 완료되면 자동으로 메시지가 전달됩니다. 이 도구는 디버깅이나 특수한 상황에서만 사용하세요.`,
    {
      id: z.number().optional().describe('에이전트의 숫자 ID'),
      alias: z.string().optional().describe('에이전트의 alias'),
    },
    async (args) => {
      const { id, alias } = args;

      let subsession;
      if (id !== undefined) {
        subsession = interSessionBus.findSubsessionById(id);
      } else if (alias) {
        subsession = interSessionBus.findSubsessionByAlias(alias);
      }

      if (!subsession) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: 'Stateful Agent를 찾을 수 없습니다.',
          }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true,
          id: subsession.id,
          alias: subsession.alias,
          status: subsession.status,
          progress: subsession.progress,
          lastResult: subsession.lastResult,
          lastError: subsession.lastError,
        }) }],
      };
    }
  );

  // ----------------------------------------
  // close_agent
  // ----------------------------------------
  server.tool(
    'close_agent',
    'Stateful Agent를 종료합니다.',
    {
      id: z.number().optional().describe('에이전트의 숫자 ID'),
      alias: z.string().optional().describe('에이전트의 alias'),
      archive_thread: z.boolean().optional().describe('Discord 스레드 아카이브 여부 (기본: true)'),
    },
    async (args) => {
      const { id, alias, archive_thread = true } = args;

      let subsession;
      if (id !== undefined) {
        subsession = interSessionBus.findSubsessionById(id);
      } else if (alias) {
        subsession = interSessionBus.findSubsessionByAlias(alias);
      }

      if (!subsession) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            message: 'Stateful Agent를 찾을 수 없습니다.',
          }) }],
        };
      }

      try {
        if (archive_thread) {
          try {
            const thread = await config.discordClient.channels.fetch(subsession.threadId);
            if (thread && 'setArchived' in thread) {
              await (thread as any).setArchived(true, 'Stateful Agent 종료');
            }
          } catch (err) {
            console.warn(`[close_agent] Failed to archive thread: ${err}`);
          }
        }

        await config.onSubsessionClosed(subsession.threadId);
        interSessionBus.cleanup(subsession.threadId);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            message: `Stateful Agent '${subsession.alias}' (ID: ${subsession.id})가 종료되었습니다.`,
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            message: `Stateful Agent 종료 실패: ${(error as Error).message}`,
          }) }],
        };
      }
    }
  );

  // ----------------------------------------
  // respond_to_agent
  // ----------------------------------------
  server.tool(
    'respond_to_agent',
    'Stateful Agent의 ask_parent 요청에 응답합니다.',
    {
      requestId: z.string().describe('요청 ID'),
      approved: z.boolean().optional().describe('승인 여부 (approval_request인 경우)'),
      response: z.string().describe('응답 내용'),
    },
    async (args) => {
      const { requestId, approved, response } = args;

      const result = interSessionBus.respondToSubsession(requestId, approved, response);

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  // ----------------------------------------
  // list_agents (공통)
  // ----------------------------------------
  server.tool(
    'list_agents',
    '현재 활성화된 모든 Stateful Agent 목록과 상태를 확인합니다.',
    {},
    async () => {
      const allSubsessions = interSessionBus.getAllSubsessions();

      const agents = allSubsessions.map((s) => ({
        id: s.id,
        alias: s.alias,
        status: s.status,
        threadId: s.threadId,
        assignedPaths: s.assignedPaths,
        progress: s.progress,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true,
          agents,
        }) }],
      };
    }
  );

  return server;
}

/**
 * Stateful Agent용 MCP 서버 생성 (child)
 */
export function createSubsessionMcpServer(
  _config: SubsessionMcpServerConfig,
  context: ExecutionContext
): McpServer {
  const server = new McpServer({
    name: 'stateful-agent-child',
    version: '1.0.0',
  });

  const { session } = context;
  if (!isSubsession(session)) {
    throw new Error('Expected subsession');
  }

  // ----------------------------------------
  // notify_parent
  // ----------------------------------------
  server.tool(
    'notify_parent',
    '부모 세션에 단방향 알림을 보냅니다. 응답이 필요 없는 정보 전달에만 사용합니다.',
    {
      type: z.enum(['info', 'warning']).describe('알림 유형'),
      message: z.string().describe('알림 내용'),
    },
    async (args) => {
      const { type, message } = args;

      try {
        await interSessionBus.notifyParent(
          session.threadId,
          session.parentThreadId,
          type,
          message
        );

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            message: '알림이 전송되었습니다.',
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            message: `알림 전송 실패: ${(error as Error).message}`,
          }) }],
        };
      }
    }
  );

  // ----------------------------------------
  // ask_parent
  // ----------------------------------------
  server.tool(
    'ask_parent',
    '부모 세션에 질문하거나 승인을 요청하고 응답을 기다립니다.',
    {
      type: z.enum(['question', 'approval_request']).describe('요청 유형'),
      message: z.string().describe('질문 또는 승인 요청 내용'),
      timeout_ms: z.number().optional().describe('응답 대기 타임아웃 (기본 5분)'),
    },
    async (args) => {
      const { type, message, timeout_ms = 300000 } = args;

      try {
        const result = await interSessionBus.askParent(
          session.threadId,
          session.parentThreadId,
          type,
          message,
          timeout_ms
        );

        if (result.timeout) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              success: false,
              timeout: true,
              error: '응답 대기 시간이 초과되었습니다.',
            }) }],
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            approved: result.approved,
            response: result.response,
            timeout: false,
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: `질문/승인 요청 실패: ${(error as Error).message}`,
          }) }],
        };
      }
    }
  );

  // ----------------------------------------
  // update_progress
  // ----------------------------------------
  server.tool(
    'update_progress',
    '현재 작업 진행 상황을 업데이트합니다.',
    {
      progress: z.string().describe('현재 진행 상황'),
    },
    async (args) => {
      const { progress } = args;

      interSessionBus.updateProgress(session.threadId, progress);

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true,
          message: '진행 상황이 업데이트되었습니다.',
        }) }],
      };
    }
  );

  // ----------------------------------------
  // list_agents (공통)
  // ----------------------------------------
  server.tool(
    'list_agents',
    '현재 활성화된 모든 Stateful Agent 목록과 상태를 확인합니다. (읽기 전용)',
    {},
    async () => {
      const allSubsessions = interSessionBus.getAllSubsessions();

      const agents = allSubsessions.map((s) => ({
        id: s.id,
        alias: s.alias,
        status: s.status,
        threadId: s.threadId,
        assignedPaths: s.assignedPaths,
        progress: s.progress,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true,
          agents,
        }) }],
      };
    }
  );

  return server;
}

// ============================================
// Singleton Manager
// ============================================

let mcpServerConfig: SubsessionMcpServerConfig | null = null;

/**
 * MCP 서버 설정 초기화
 */
export function initMcpServerConfig(config: SubsessionMcpServerConfig): void {
  mcpServerConfig = config;
}

/**
 * 세션에 맞는 MCP 서버 생성
 */
export function createMcpServerForSession(session: SessionInfo): McpServer {
  if (!mcpServerConfig) {
    throw new Error('MCP server config not initialized. Call initMcpServerConfig first.');
  }

  const context: ExecutionContext = {
    threadId: session.threadId,
    session,
  };

  if (isMainSession(session)) {
    return createMainSessionMcpServer(mcpServerConfig, context);
  } else {
    return createSubsessionMcpServer(mcpServerConfig, context);
  }
}

/**
 * MCP 서버 설정 가져오기
 */
export function getMcpServerConfig(): SubsessionMcpServerConfig {
  if (!mcpServerConfig) {
    throw new Error('MCP server config not initialized');
  }
  return mcpServerConfig;
}
