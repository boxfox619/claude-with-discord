import { Client, TextChannel, ThreadChannel, ThreadAutoArchiveDuration } from 'discord.js';
import { randomUUID } from 'crypto';

interface ThreadCreateOptions {
  autoArchiveDuration?: ThreadAutoArchiveDuration;
  reason?: string;
}

interface PendingThreadCreation {
  id: string;
  channelId: string;
  name: string;
  options: ThreadCreateOptions;
  resolve: (thread: ThreadChannel) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ThreadCreationQueue - Discord 스레드 생성 큐
 *
 * Discord rate limit을 고려하여 스레드 생성 요청을 큐잉합니다.
 * - 스레드 생성 간 최소 1초 간격
 * - 429 에러 시 Retry-After 존중
 */
class ThreadCreationQueue {
  private client: Client;
  private queue: PendingThreadCreation[] = [];
  private isProcessing = false;
  private lastCreationTime = 0;

  // 최소 간격: 1초 (Discord rate limit 대응)
  private readonly MIN_INTERVAL_MS = 1000;
  // 최대 큐 크기
  private readonly MAX_QUEUE_SIZE = 50;
  // 타임아웃: 30초
  private readonly TIMEOUT_MS = 30000;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * 스레드 생성 요청
   */
  async createThread(
    channelId: string,
    name: string,
    options: ThreadCreateOptions = {}
  ): Promise<ThreadChannel> {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error('Thread creation queue is full');
    }

    return new Promise((resolve, reject) => {
      const item: PendingThreadCreation = {
        id: randomUUID(),
        channelId,
        name,
        options,
        resolve,
        reject,
        createdAt: Date.now(),
      };

      // 타임아웃 설정
      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex((i) => i.id === item.id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Thread creation timeout'));
        }
      }, this.TIMEOUT_MS);

      // resolve/reject 래핑하여 타임아웃 클리어
      const wrappedResolve = (thread: ThreadChannel) => {
        clearTimeout(timeoutId);
        resolve(thread);
      };

      const wrappedReject = (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      };

      item.resolve = wrappedResolve;
      item.reject = wrappedReject;

      this.queue.push(item);
      this.processQueue();
    });
  }

  /**
   * 큐 처리
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      // 최소 간격 대기
      const elapsed = Date.now() - this.lastCreationTime;
      if (elapsed < this.MIN_INTERVAL_MS) {
        await sleep(this.MIN_INTERVAL_MS - elapsed);
      }

      const item = this.queue.shift()!;

      try {
        const channel = await this.client.channels.fetch(item.channelId);

        if (!channel || !('threads' in channel)) {
          item.reject(new Error('Invalid channel or channel does not support threads'));
          continue;
        }

        const thread = await (channel as TextChannel).threads.create({
          name: item.name,
          autoArchiveDuration: item.options.autoArchiveDuration || ThreadAutoArchiveDuration.OneDay,
          reason: item.options.reason,
        });

        this.lastCreationTime = Date.now();
        item.resolve(thread);
      } catch (error) {
        if (this.isRateLimitError(error)) {
          // 429 에러: Retry-After 만큼 대기 후 재시도
          const retryAfter = this.getRetryAfter(error);
          console.warn(`[ThreadCreationQueue] Rate limited. Retrying after ${retryAfter}ms`);
          await sleep(retryAfter);
          this.queue.unshift(item); // 다시 큐 앞에 추가
        } else {
          console.error('[ThreadCreationQueue] Failed to create thread:', error);
          item.reject(error as Error);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Rate limit 에러 체크
   */
  private isRateLimitError(error: unknown): boolean {
    return (error as { status?: number })?.status === 429;
  }

  /**
   * Retry-After 값 추출
   */
  private getRetryAfter(error: unknown): number {
    const retryAfter = (error as { retryAfter?: number })?.retryAfter;
    return (retryAfter ?? 5) * 1000;
  }

  /**
   * 큐 상태 조회
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * 큐 비우기
   */
  clearQueue(): void {
    for (const item of this.queue) {
      item.reject(new Error('Queue cleared'));
    }
    this.queue = [];
  }
}

// 싱글톤 인스턴스
let threadCreationQueue: ThreadCreationQueue | null = null;

/**
 * ThreadCreationQueue 초기화
 * Discord client ready 시점에 호출
 */
export const initThreadCreationQueue = (client: Client): void => {
  threadCreationQueue = new ThreadCreationQueue(client);
};

/**
 * ThreadCreationQueue 인스턴스 가져오기
 */
export const getThreadCreationQueue = (): ThreadCreationQueue => {
  if (!threadCreationQueue) {
    throw new Error('ThreadCreationQueue not initialized. Call initThreadCreationQueue first.');
  }
  return threadCreationQueue;
};

export { threadCreationQueue, ThreadCreationQueue };
