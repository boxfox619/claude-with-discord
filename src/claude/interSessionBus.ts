import { randomUUID } from 'crypto';
import type {
  InterSessionMessage,
  PendingTask,
  PendingResponse,
  SubsessionState,
  TaskResult,
} from '../types.js';

type MessageHandler = (message: InterSessionMessage) => void | Promise<void>;

/**
 * InterSessionBus - 세션 간 메시지 버스 (싱글톤)
 *
 * 메인 세션과 서브세션 간의 통신을 담당합니다.
 * - 메모리 기반 메시지 큐
 * - 작업 위임 및 결과 수집
 * - ask_parent 응답 대기
 */
class InterSessionBus {
  private static instance: InterSessionBus;

  // 메시지 큐 (threadId -> messages)
  private messageQueues: Map<string, InterSessionMessage[]> = new Map();

  // 대기 중인 작업 (taskId -> PendingTask)
  private pendingTasks: Map<string, PendingTask> = new Map();

  // 응답 대기 (requestId -> PendingResponse)
  private pendingResponses: Map<string, PendingResponse> = new Map();

  // 세션 상태 (threadId -> SubsessionState)
  private sessionStates: Map<string, SubsessionState> = new Map();

  // 메시지 핸들러 (threadId -> handler)
  private messageHandlers: Map<string, MessageHandler> = new Map();

  // Discord 메시지 전송 콜백
  private discordMessageCallback?: (threadId: string, content: string, embed?: object) => Promise<void>;

  private constructor() {}

  static getInstance(): InterSessionBus {
    if (!InterSessionBus.instance) {
      InterSessionBus.instance = new InterSessionBus();
    }
    return InterSessionBus.instance;
  }

  /**
   * Discord 메시지 콜백 설정
   */
  setDiscordMessageCallback(callback: (threadId: string, content: string, embed?: object) => Promise<void>): void {
    this.discordMessageCallback = callback;
  }

  /**
   * 메시지 핸들러 등록
   */
  registerHandler(threadId: string, handler: MessageHandler): void {
    this.messageHandlers.set(threadId, handler);
  }

  /**
   * 메시지 핸들러 해제
   */
  unregisterHandler(threadId: string): void {
    this.messageHandlers.delete(threadId);
  }

  /**
   * 서브세션 상태 등록
   */
  registerSubsession(state: SubsessionState): void {
    this.sessionStates.set(state.threadId, state);
  }

  /**
   * 서브세션 상태 해제
   */
  unregisterSubsession(threadId: string): void {
    this.sessionStates.delete(threadId);
    this.messageQueues.delete(threadId);
    this.messageHandlers.delete(threadId);
  }

  /**
   * 서브세션 상태 조회
   */
  getSubsessionState(threadId: string): SubsessionState | undefined {
    return this.sessionStates.get(threadId);
  }

  /**
   * alias로 서브세션 찾기
   */
  findSubsessionByAlias(alias: string): SubsessionState | undefined {
    for (const state of this.sessionStates.values()) {
      if (state.alias === alias) {
        return state;
      }
    }
    return undefined;
  }

  /**
   * id로 서브세션 찾기
   */
  findSubsessionById(id: number): SubsessionState | undefined {
    for (const state of this.sessionStates.values()) {
      if (state.id === id) {
        return state;
      }
    }
    return undefined;
  }

  /**
   * 모든 서브세션 목록 조회
   */
  getAllSubsessions(): SubsessionState[] {
    return Array.from(this.sessionStates.values());
  }

  /**
   * 서브세션 상태 업데이트
   */
  updateSubsessionState(threadId: string, updates: Partial<SubsessionState>): void {
    const state = this.sessionStates.get(threadId);
    if (state) {
      Object.assign(state, updates, { lastActivityAt: Date.now() });
    }
  }

  // ============================================
  // 메시지 전송
  // ============================================

  /**
   * 메시지 전송 (내부)
   */
  private async send(message: InterSessionMessage): Promise<void> {
    const queue = this.messageQueues.get(message.to.threadId) || [];
    queue.push(message);
    this.messageQueues.set(message.to.threadId, queue);

    // 핸들러가 있으면 즉시 전달
    const handler = this.messageHandlers.get(message.to.threadId);
    if (handler) {
      await handler(message);
    }
  }

  /**
   * Discord에 메시지 표시
   */
  private async displayInDiscord(
    threadId: string,
    type: 'task_delegated' | 'task_received' | 'result_sent' | 'result_received' | 'notify' | 'request' | 'progress',
    content: string,
    fromAlias?: string
  ): Promise<void> {
    if (!this.discordMessageCallback) return;

    const icons = {
      task_delegated: '📤',
      task_received: '📥',
      result_sent: '📤',
      result_received: '📥',
      notify: '💬',
      request: '❓',
      progress: '⏳',
    };

    const labels = {
      task_delegated: '작업 위임',
      task_received: '작업 요청',
      result_sent: '결과 전송',
      result_received: '결과 도착',
      notify: '알림',
      request: '질문/승인 요청',
      progress: '진행 상황',
    };

    const icon = icons[type];
    const label = labels[type];
    const source = fromAlias ? `[${fromAlias}]` : '[메인]';

    await this.discordMessageCallback(threadId, `${icon} ${source} ${label}\n${content}`);
  }

  // ============================================
  // 작업 위임 (메인 → 서브)
  // ============================================

  /**
   * 서브세션에 작업 위임
   */
  async delegateTask(
    parentThreadId: string,
    target: { id?: number; alias?: string },
    task: string,
    checkAfterMs: number = 120000
  ): Promise<{ success: boolean; taskId?: string; message: string }> {
    // 타겟 서브세션 찾기
    let subsession: SubsessionState | undefined;
    if (target.id !== undefined) {
      subsession = this.findSubsessionById(target.id);
    } else if (target.alias) {
      subsession = this.findSubsessionByAlias(target.alias);
    }

    if (!subsession) {
      return { success: false, message: '서브세션을 찾을 수 없습니다.' };
    }

    const taskId = randomUUID();

    // PendingTask 등록
    const pendingTask: PendingTask = {
      taskId,
      targetThreadId: subsession.threadId,
      targetAlias: subsession.alias,
      task,
      delegatedAt: Date.now(),
      checkAfterMs,
    };

    // 타임아웃 체크 스케줄링
    pendingTask.timeoutId = setTimeout(() => {
      this.checkTaskTimeout(taskId, parentThreadId);
    }, checkAfterMs);

    this.pendingTasks.set(taskId, pendingTask);

    // 서브세션 상태 업데이트
    this.updateSubsessionState(subsession.threadId, { status: 'working' });

    // 메시지 전송
    const message: InterSessionMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: { threadId: parentThreadId, isMain: true },
      to: { threadId: subsession.threadId, alias: subsession.alias },
      type: 'task',
      content: task,
      summary: task.slice(0, 100),
      taskId,
      waitingForResponse: false,
    };

    await this.send(message);

    // Discord에 표시
    await this.displayInDiscord(parentThreadId, 'task_delegated', `[${subsession.alias}]에게: ${task.slice(0, 200)}`);
    await this.displayInDiscord(subsession.threadId, 'task_received', task);

    return { success: true, taskId, message: '작업이 위임되었습니다.' };
  }

  /**
   * 타임아웃 체크
   */
  private async checkTaskTimeout(taskId: string, parentThreadId: string): Promise<void> {
    const task = this.pendingTasks.get(taskId);
    if (!task) return;

    const subsession = this.sessionStates.get(task.targetThreadId);
    if (!subsession) return;

    const progressMsg = subsession.progress || '작업 진행 중...';

    await this.displayInDiscord(
      parentThreadId,
      'progress',
      `[${subsession.alias}] ${Math.floor(task.checkAfterMs / 60000)}분 경과\n진행: "${progressMsg}"`
    );
  }

  // ============================================
  // 결과 전송 (서브 → 메인)
  // ============================================

  /**
   * 서브세션 작업 완료 시 결과 전송
   */
  async onSubsessionComplete(
    subsessionThreadId: string,
    parentThreadId: string,
    taskId: string,
    result: TaskResult
  ): Promise<void> {
    // PendingTask 정리
    const task = this.pendingTasks.get(taskId);
    if (task?.timeoutId) {
      clearTimeout(task.timeoutId);
    }
    this.pendingTasks.delete(taskId);

    // 서브세션 상태 업데이트
    const subsession = this.sessionStates.get(subsessionThreadId);
    if (subsession) {
      this.updateSubsessionState(subsessionThreadId, {
        status: 'completed',
        lastResult: result.result,
      });
    }

    // 메시지 전송
    const message: InterSessionMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: { threadId: subsessionThreadId, alias: subsession?.alias, isMain: false },
      to: { threadId: parentThreadId },
      type: 'result',
      content: result.result,
      summary: result.summary.slice(0, 500),
      taskId,
      waitingForResponse: false,
    };

    await this.send(message);

    // Discord에 표시
    await this.displayInDiscord(subsessionThreadId, 'result_sent', '[메인]에게 결과 전송');
    await this.displayInDiscord(
      parentThreadId,
      'result_received',
      `[${subsession?.alias || 'subsession'}] 결과:\n${result.summary}`
    );
  }

  // ============================================
  // 알림 (서브 → 메인)
  // ============================================

  /**
   * 부모에게 단방향 알림
   */
  async notifyParent(
    subsessionThreadId: string,
    parentThreadId: string,
    type: 'info' | 'warning',
    messageContent: string
  ): Promise<void> {
    const subsession = this.sessionStates.get(subsessionThreadId);

    const message: InterSessionMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: { threadId: subsessionThreadId, alias: subsession?.alias, isMain: false },
      to: { threadId: parentThreadId },
      type: 'notify',
      content: messageContent,
      summary: messageContent.slice(0, 200),
      waitingForResponse: false,
    };

    await this.send(message);

    const icon = type === 'warning' ? '⚠️' : 'ℹ️';
    await this.displayInDiscord(
      parentThreadId,
      'notify',
      `${icon} [${subsession?.alias || 'subsession'}]: ${messageContent}`
    );
  }

  // ============================================
  // 질문/승인 요청 (서브 → 메인 → 서브)
  // ============================================

  /**
   * 부모에게 질문/승인 요청 (응답 대기)
   */
  async askParent(
    subsessionThreadId: string,
    parentThreadId: string,
    type: 'question' | 'approval_request',
    messageContent: string,
    timeoutMs: number = 300000
  ): Promise<{ approved?: boolean; response: string; timeout: boolean }> {
    const subsession = this.sessionStates.get(subsessionThreadId);
    const requestId = randomUUID();

    return new Promise((resolve) => {
      // PendingResponse 등록
      const pending: PendingResponse = {
        requestId,
        fromThreadId: subsessionThreadId,
        fromAlias: subsession?.alias,
        message: messageContent,
        type,
        requestedAt: Date.now(),
        timeoutMs,
        resolve,
      };

      this.pendingResponses.set(requestId, pending);

      // 타임아웃 설정
      setTimeout(() => {
        if (this.pendingResponses.has(requestId)) {
          this.pendingResponses.delete(requestId);
          resolve({ response: '', timeout: true });
        }
      }, timeoutMs);

      // 메시지 전송
      const message: InterSessionMessage = {
        id: randomUUID(),
        timestamp: Date.now(),
        from: { threadId: subsessionThreadId, alias: subsession?.alias, isMain: false },
        to: { threadId: parentThreadId },
        type: 'request',
        content: messageContent,
        summary: messageContent.slice(0, 200),
        requestId,
        waitingForResponse: true,
      };

      this.send(message);

      // Discord에 표시
      const icon = type === 'approval_request' ? '🔐' : '❓';
      const label = type === 'approval_request' ? '승인 요청' : '질문';
      this.displayInDiscord(
        parentThreadId,
        'request',
        `${icon} [${subsession?.alias || 'subsession'}] ${label}:\n${messageContent}\n\n(requestId: ${requestId})`
      );
    });
  }

  /**
   * 서브세션 요청에 응답 (메인이 호출)
   */
  respondToSubsession(
    requestId: string,
    approved: boolean | undefined,
    response: string
  ): { success: boolean; message: string } {
    const pending = this.pendingResponses.get(requestId);
    if (!pending) {
      return { success: false, message: '해당 요청을 찾을 수 없습니다.' };
    }

    this.pendingResponses.delete(requestId);
    pending.resolve({ approved, response, timeout: false });

    return { success: true, message: '응답이 전송되었습니다.' };
  }

  // ============================================
  // 진행 상황 업데이트
  // ============================================

  /**
   * 진행 상황 업데이트
   */
  updateProgress(subsessionThreadId: string, progress: string): void {
    this.updateSubsessionState(subsessionThreadId, { progress });
  }

  // ============================================
  // 메시지 큐 조회
  // ============================================

  /**
   * 메시지 큐에서 메시지 가져오기 (소비)
   */
  consumeMessages(threadId: string): InterSessionMessage[] {
    const messages = this.messageQueues.get(threadId) || [];
    this.messageQueues.set(threadId, []);
    return messages;
  }

  /**
   * 메시지 큐 조회 (소비하지 않음)
   */
  peekMessages(threadId: string): InterSessionMessage[] {
    return this.messageQueues.get(threadId) || [];
  }

  // ============================================
  // 정리
  // ============================================

  /**
   * 특정 세션 관련 리소스 정리
   */
  cleanup(threadId: string): void {
    this.unregisterSubsession(threadId);

    // 관련 pending tasks 정리
    for (const [taskId, task] of this.pendingTasks.entries()) {
      if (task.targetThreadId === threadId) {
        if (task.timeoutId) clearTimeout(task.timeoutId);
        this.pendingTasks.delete(taskId);
      }
    }

    // 관련 pending responses 정리
    for (const [requestId, pending] of this.pendingResponses.entries()) {
      if (pending.fromThreadId === threadId) {
        pending.resolve({ response: '', timeout: true });
        this.pendingResponses.delete(requestId);
      }
    }
  }

  /**
   * 전체 리셋 (테스트용)
   */
  reset(): void {
    this.messageQueues.clear();
    this.pendingTasks.clear();
    this.pendingResponses.clear();
    this.sessionStates.clear();
    this.messageHandlers.clear();
  }
}

// 싱글톤 export
export const interSessionBus = InterSessionBus.getInstance();
