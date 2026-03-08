import type { Query, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export type SessionMode = "action" | "plan" | "ask";

export interface ImageContent {
  type: "image";
  data: string;
  mediaType: string;
}

export interface PendingImage {
  index: number;
  url: string;
  filename: string;
  data: string;
  mediaType: string;
}

export interface AudioTranscription {
  filename: string;
  text: string;
  duration?: number;
}

export interface QueuedMessage {
  userMessage: string;
  images: ImageContent[];
  pendingImages: PendingImage[];
  audioTranscriptions?: AudioTranscription[];
}

export interface AppConfig {
  channel_project_map: Record<string, string>;
  channel_system_prompts: Record<string, string>;
  global_context?: string;
  permission_mode: "default" | "acceptEdits" | "bypassPermissions";
  max_budget_usd: number;
  max_turns: number;
  max_concurrent_sessions: number;
  session_timeout_minutes: number;
  allowed_users: string[];
  openai_api_key?: string;
  whisper_mode?: "api" | "local";  // "api" uses OpenAI API, "local" uses local whisper CLI
  whisper_model?: string;  // For local mode: tiny, base, small, medium, large
  // TTS settings
  tts_enabled?: boolean;  // Enable TTS for Claude responses (default: false)
  tts_voice?: string;  // Voice to use: ko-KR-SunHiNeural (female), ko-KR-InJoonNeural (male)
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  suggestions?: PermissionUpdate[];
  resolve: (result: PermissionResult) => void;
  // For AskUserQuestion
  isQuestion?: boolean;
  questions?: Question[];
  selectedAnswers?: Record<string, string>;
  awaitingCustomInput?: boolean;
  customInputQuestionIndex?: number;
  currentQuestionIndex?: number;
}

// ============================================
// Session Types (Main & Subsession)
// ============================================

// 공통 필드
export interface BaseSessionInfo {
  sessionId: string;
  threadId: string;
  channelId: string;
  projectPath: string;
  query: Query | null;
  abortController: AbortController;
  totalCostUsd: number;
  lastActivityAt: number;
  isProcessing: boolean;
  mode: SessionMode;
  pendingPermission?: PendingPermission;
  pendingImages?: PendingImage[];
  messageQueue: QueuedMessage[];
}

// 메인 세션 전용
export interface MainSessionInfo extends BaseSessionInfo {
  isSubsession: false;
  childSubsessions: Map<number, SubsessionState>;
  nextSubsessionId: number;
}

// 서브세션 전용
export interface SubsessionSessionInfo extends BaseSessionInfo {
  isSubsession: true;
  subsessionId: number;
  alias: string;
  parentThreadId: string;
  lastResult?: string;
  progress?: string;
}

// 유니온 타입
export type SessionInfo = MainSessionInfo | SubsessionSessionInfo;

// 타입 가드
export function isSubsession(session: SessionInfo): session is SubsessionSessionInfo {
  return session.isSubsession === true;
}

export function isMainSession(session: SessionInfo): session is MainSessionInfo {
  return session.isSubsession === false;
}

// ============================================
// Subsession Types
// ============================================

export type SubsessionStatus = 'idle' | 'working' | 'completed' | 'error';

export interface SubsessionState {
  id: number;
  alias: string;
  threadId: string;
  status: SubsessionStatus;
  progress?: string;
  lastResult?: string;
  lastError?: string;
  createdAt: number;
  lastActivityAt: number;
  assignedPaths?: string[];
}

export interface SubsessionContext {
  relevant_files?: string[];
  background?: string;
  constraints?: string[];
}

// ============================================
// Inter-Session Communication
// ============================================

export interface InterSessionMessage {
  id: string;
  timestamp: number;
  from: {
    threadId: string;
    alias?: string;
    isMain: boolean;
  };
  to: {
    threadId: string;
    alias?: string;
  };
  type: 'task' | 'result' | 'notify' | 'request' | 'response' | 'status_update';
  content: string;
  summary: string;
  taskId?: string;
  requestId?: string;
  waitingForResponse: boolean;
}

export interface PendingTask {
  taskId: string;
  targetThreadId: string;
  targetAlias?: string;
  task: string;
  delegatedAt: number;
  checkAfterMs: number;
  timeoutId?: NodeJS.Timeout;
}

export interface PendingResponse {
  requestId: string;
  fromThreadId: string;
  fromAlias?: string;
  message: string;
  type: 'question' | 'approval_request';
  requestedAt: number;
  timeoutMs: number;
  resolve: (response: { approved?: boolean; response: string; timeout: boolean }) => void;
}

export interface TaskResult {
  result: string;
  summary: string;
  attachments?: TaskAttachment[];
}

export interface TaskAttachment {
  filename: string;
  content: string;
  type: 'text' | 'json' | 'markdown';
}

// ============================================
// Subsession Limits
// ============================================

export const SUBSESSION_LIMITS = {
  MAX_SUBSESSIONS_PER_SESSION: 5,
  MAX_TOTAL_SUBSESSIONS: 20,
  IDLE_TIMEOUT_MS: 86400000, // 24시간
  DEFAULT_CHECK_AFTER_MS: 120000, // 2분
} as const;

export const RESULT_LIMITS = {
  SUMMARY_MAX_LENGTH: 500,
  RESULT_MAX_LENGTH: 10000,
  ATTACHMENT_MAX_SIZE: 100000,
  MAX_ATTACHMENTS: 3,
} as const;

export const ALIAS_RULES = {
  pattern: /^[a-z][a-z0-9-]{0,29}$/,
  maxLength: 30,
  reserved: ["main", "parent", "system", "all", "self", "me", "root"],
} as const;
