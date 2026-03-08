# Subsession System Design

## Overview

메인 세션이 서브세션을 생성하고, 작업을 위임하며, 결과를 수집할 수 있는 시스템.
서브세션은 독립적인 컨텍스트를 유지하며 지속적으로 살아있음.

## Architecture

### Session Hierarchy

```
                    ┌─────────────────┐
                    │   Main Session  │
                    │   (메인 스레드)   │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │code-analyst│    │ impl-auth  │    │  reviewer  │
    │  (id: 1)   │    │  (id: 2)   │    │  (id: 3)   │
    │ (서브스레드) │    │ (서브스레드) │    │ (서브스레드) │
    └────────────┘    └────────────┘    └────────────┘
```

### Session Identification

서브세션은 세 가지 방식으로 식별:

| 식별자 | 설명 | 예시 |
|-------|------|------|
| `id` | 세션 내 고유 숫자 (자동 부여) | `1`, `2`, `3` |
| `alias` | 사용자 지정 고유 식별자 | `"code-analyst"`, `"impl-auth"` |
| `threadId` | Discord 스레드 ID | `"123456789"` |

### Communication Channels

```
┌──────────────────────────────────────────────────────────┐
│                    InterSessionBus                       │
│           (메모리 기반 + Discord 표시)                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Parent → Child:  delegate_task                          │
│  Child → Parent:  notify_parent, ask_parent              │
│                                                          │
│  ❌ Sibling ↔ Sibling: 직접 통신 불가                     │
│     (메인을 통해 조율)                                    │
│                                                          │
│  + User can interact with any session directly           │
│                                                          │
│  메시지는 받는 쪽 스레드에 Discord로 표시됨                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Discord Structure

Discord는 서브스레드(nested thread)를 지원하지 않으므로, 같은 채널에 별도 스레드로 생성:

```
Channel
├── Main Thread: "작업 요청 제목"
├── [Sub:code-analyst] 작업 요청 제목
├── [Sub:impl-auth] 작업 요청 제목
└── [Sub:reviewer] 작업 요청 제목
```

## Result Delivery

### Push 기본 + Timeout Pull 폴백

```
┌──────────────────────────────────────────────────────────┐
│                    결과 수신 전략                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. 기본: 서브세션이 완료 시 자동 Push                    │
│                                                          │
│  2. 폴백: 일정 시간 지나도 응답 없으면 메인이 상태 체크     │
│                                                          │
│  Main Session                      Subsession            │
│       │                                │                 │
│       │  delegate_task("분석해줘")      │                 │
│       │ ──────────────────────────────▶│                 │
│       │                                │                 │
│       │  타이머 시작 (기본: 2분)        │  작업 중...     │
│       │                                │                 │
│       │  [Case A: 정상 완료]           │                 │
│       │    ◀───────────────────────── │  완료! Push     │
│       │                                │                 │
│       │  [Case B: 타임아웃]            │                 │
│       │  2분 경과 → 자동 상태 체크      │                 │
│       │    ◀───────────────────────── │  "작업 중..."   │
│       │                                │                 │
└──────────────────────────────────────────────────────────┘
```

### 결과 형식

서브세션이 작업 완료 시 결과와 요약을 함께 생성합니다:

```typescript
// 서브세션 작업 완료 시 반환 형식
interface TaskResult {
  result: string;              // 전체 결과 (서브세션 스레드에 저장)
  summary: string;             // 메인에 표시할 요약 (서브세션이 생성)
  attachments?: Attachment[];  // 대용량 결과용 첨부 파일 (선택)
}

interface Attachment {
  filename: string;            // 파일명 (예: "analysis-report.md")
  content: string;             // 파일 내용
  type: 'text' | 'json' | 'markdown';
}

// 길이 제한
const RESULT_LIMITS = {
  SUMMARY_MAX_LENGTH: 500,         // 요약: 최대 500자 (Discord 임베드 고려)
  RESULT_MAX_LENGTH: 10000,        // 전체 결과: 최대 10,000자
  ATTACHMENT_MAX_SIZE: 100000,     // 첨부 파일당: 최대 100KB
  MAX_ATTACHMENTS: 3,              // 첨부 파일 최대 개수
};
```

**대용량 결과 처리:**

| 결과 크기 | 처리 방식 |
|----------|----------|
| ~10,000자 | `result` 필드에 직접 포함 |
| 10,000자 초과 | `attachments`로 분리, `result`에는 요약만 |
| 100KB 초과 | 여러 첨부 파일로 분할 또는 페이지네이션 |

```typescript
// 대용량 결과 예시
{
  result: "분석 완료. 상세 내용은 첨부 파일 참조.",
  summary: "총 150개 파일 분석, 주요 이슈 5건 발견",
  attachments: [
    {
      filename: "full-analysis.md",
      content: "# 전체 분석 결과\n...(상세 내용)...",
      type: "markdown"
    }
  ]
}
```

> **Note**: 서브세션이 작업 맥락을 가장 잘 알고 있으므로, 요약도 서브세션이 직접 생성합니다.
> 요약이 500자를 초과하면 자동으로 잘리고 "..." 표시됩니다.
> 첨부 파일은 Discord에 파일로 업로드되며, 메인 스레드에서 다운로드 가능합니다.

## MCP Tools

### For Main Session (메인 세션용)

#### `create_subsession`

새 서브세션을 생성합니다.

```typescript
{
  name: "create_subsession",
  description: "서브세션을 생성합니다. 서브세션은 독립된 Discord 스레드에서 실행되며, 컨텍스트를 유지합니다.",
  input_schema: {
    type: "object",
    properties: {
      alias: {
        type: "string",
        description: "서브세션 식별자 (고유, 영문 소문자/숫자/하이픈, 예: code-analyst)"
      },
      description: {
        type: "string",
        description: "서브세션의 역할과 지침 (시스템 프롬프트에 포함됨)"
      },
      context: {
        type: "object",
        description: "초기 컨텍스트 (선택)",
        properties: {
          relevant_files: {
            type: "array",
            items: { type: "string" },
            description: "관련 파일 경로 목록"
          },
          background: {
            type: "string",
            description: "배경 정보"
          },
          constraints: {
            type: "array",
            items: { type: "string" },
            description: "제약 조건 목록"
          }
        }
      },
    },
    required: ["alias", "description"]
  },
  output_schema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      id: { type: "number", description: "세션 내 고유 숫자 ID" },
      alias: { type: "string" },
      threadId: { type: "string" }
    }
  }
}
```

#### `delegate_to_subsession`

서브세션에 작업을 위임합니다.

> **Note**: `targetId` 또는 `targetAlias` 중 하나만 지정합니다. 둘 다 지정 시 `targetId` 우선.

```typescript
{
  name: "delegate_to_subsession",
  description: "서브세션에 작업을 위임합니다. 결과는 완료 시 자동으로 전달됩니다.",
  input_schema: {
    type: "object",
    properties: {
      targetId: {
        type: "number",
        description: "대상 서브세션의 숫자 ID"
      },
      targetAlias: {
        type: "string",
        description: "대상 서브세션의 alias"
      },
      task: { type: "string", description: "위임할 작업" },
      check_after_ms: {
        type: "number",
        default: 120000,
        description: "이 시간 후에도 결과 없으면 상태 체크 알림 (기본 2분)"
      }
    },
    required: ["task"]  // targetId 또는 targetAlias 중 하나 필수 (런타임 검증)
  },
  output_schema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      taskId: { type: "string" },
      message: { type: "string" }
    }
  }
}
```

#### `check_subsession_status`

서브세션의 현재 상태를 확인합니다.

```typescript
{
  name: "check_subsession_status",
  description: "서브세션의 현재 상태를 확인합니다.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "number" },
      alias: { type: "string" }
    }
  },
  output_schema: {
    type: "object",
    properties: {
      id: { type: "number" },
      alias: { type: "string" },
      status: { type: "string", enum: ["idle", "working", "completed", "error"] },
      progress: { type: "string", description: "진행 상황 (있는 경우)" },
      lastResult: { type: "string", description: "마지막 결과" },
      lastError: { type: "string", description: "마지막 에러" }
    }
  }
}
```

#### `close_subsession`

서브세션을 종료합니다.

```typescript
{
  name: "close_subsession",
  description: "서브세션을 종료합니다.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "number" },
      alias: { type: "string" },
      archive_thread: { type: "boolean", default: true, description: "Discord 스레드 아카이브 여부" }
    }
  }
}
```

### For Subsessions (서브세션용)

#### `notify_parent`

부모 세션에 단방향 알림을 보냅니다. 응답이 필요한 경우 `ask_parent`를 사용하세요.

**notify_parent vs ask_parent 차이:**
| 도구 | 용도 | 응답 대기 | 사용 예시 |
|-----|------|---------|---------|
| `notify_parent` | 단방향 알림 (정보 전달) | ❌ | "분석 50% 완료", "보안 취약점 발견" |
| `ask_parent` | 양방향 질의 (결정/승인 필요) | ✅ | "어떤 방식으로 구현할까요?", "이 파일 수정해도 될까요?" |

```typescript
{
  name: "notify_parent",
  description: "부모 세션에 단방향 알림을 보냅니다. 응답이 필요 없는 정보 전달에만 사용합니다.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["info", "warning"],
        description: "알림 유형: info(일반 정보, 진행 상황), warning(주의 필요한 발견)"
      },
      message: { type: "string", description: "알림 내용" }
    },
    required: ["type", "message"]
  }
}
```

#### `ask_parent`

부모 세션에 질문/승인 요청을 보내고 응답을 기다립니다. 결정이나 승인이 필요할 때 사용합니다.

```typescript
{
  name: "ask_parent",
  description: "부모 세션에 질문하거나 승인을 요청하고 응답을 기다립니다. 코드 변경 전 승인, 구현 방향 결정 등에 사용합니다.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["question", "approval_request"],
        description: "요청 유형: question(질문/결정 필요), approval_request(코드 변경 전 승인 요청)"
      },
      message: { type: "string", description: "질문 또는 승인 요청 내용" },
      timeout_ms: {
        type: "number",
        default: 300000,
        description: "응답 대기 타임아웃 (기본 5분)"
      }
    },
    required: ["type", "message"]
  },
  output_schema: {
    type: "object",
    properties: {
      approved: { type: "boolean", description: "승인 여부 (approval_request인 경우)" },
      response: { type: "string", description: "부모의 응답 내용" },
      timeout: { type: "boolean", description: "타임아웃 발생 여부" }
    }
  }
}
```

**응답 수신 메커니즘:**

```
┌──────────────────────────────────────────────────────────────┐
│                    ask_parent 응답 흐름                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Subsession                              Main Session        │
│      │                                        │              │
│      │  ask_parent(질문)                      │              │
│      │ ────────────────────────────────────▶  │              │
│      │                                        │              │
│      │  [InterSessionBus]                     │              │
│      │  - requestId 발급                      │              │
│      │  - pendingResponses에 등록             │              │
│      │  - 메인 스레드에 Discord 메시지 표시    │              │
│      │                                        │              │
│      │  (서브세션 대기 상태)            메인이 응답 생성       │
│      │                                        │              │
│      │  응답 수신 ◀──────────────────────────  │              │
│      │                                        │              │
│      │  [InterSessionBus]                     │              │
│      │  - pendingResponses에서 resolve        │              │
│      │  - ask_parent 도구 결과로 반환          │              │
│      │                                        │              │
│      │  [타임아웃 시]                          │              │
│      │  - timeout: true 반환                  │              │
│      │  - 서브세션이 판단하여 재시도 또는 중단   │              │
│      │                                        │              │
└──────────────────────────────────────────────────────────────┘
```

**메인 세션의 응답 방법:**

메인 세션은 `respond_to_subsession` 도구로 응답합니다 (자동 생성됨):

```typescript
// 메인 세션에만 제공되는 내부 도구
{
  name: "respond_to_subsession",
  description: "서브세션의 ask_parent 요청에 응답합니다.",
  input_schema: {
    type: "object",
    properties: {
      requestId: { type: "string", description: "요청 ID" },
      approved: { type: "boolean", description: "승인 여부 (approval_request인 경우)" },
      response: { type: "string", description: "응답 내용" }
    },
    required: ["requestId", "response"]
  }
}
```

#### `update_progress`

현재 작업 진행 상황을 업데이트합니다.

```typescript
{
  name: "update_progress",
  description: "현재 작업 진행 상황을 업데이트합니다. 긴 작업 시 주기적으로 호출하면 부모 세션이 상태를 파악할 수 있습니다.",
  input_schema: {
    type: "object",
    properties: {
      progress: {
        type: "string",
        description: "현재 진행 상황 (예: '파일 50/100개 분석 완료')"
      }
    },
    required: ["progress"]
  }
}
```

### For All Sessions (공통)

#### `list_subsessions`

활성 서브세션 목록을 확인합니다.

**용도:**
- **메인 세션**: 서브세션 관리, 작업 분배 현황 파악, 위임 대상 선정
- **서브세션**: 형제 세션 현황 파악 (읽기 전용). 메인에 요청할 때 다른 서브세션 ID/alias 참조 가능
  - 예: "code-analyst(id:1)가 이미 src/auth/ 분석 중이니, 저는 src/api/를 담당하겠습니다"

> **Note**: 서브세션은 형제와 직접 통신할 수 없습니다. 조율이 필요하면 메인을 통해 처리합니다.

```typescript
{
  name: "list_subsessions",
  description: "현재 활성화된 모든 서브세션 목록과 상태를 확인합니다.",
  input_schema: {
    type: "object",
    properties: {}
  },
  output_schema: {
    type: "object",
    properties: {
      subsessions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            alias: { type: "string" },
            status: { type: "string", enum: ["idle", "working", "completed", "error"] },
            threadId: { type: "string" },
            assignedPaths: {
              type: "array",
              items: { type: "string" },
              description: "담당 파일/디렉토리 경로"
            }
          }
        }
      }
    }
  }
}
```

## Subsession System Prompt

서브세션에는 역할, 컨텍스트, 행동 규칙이 포함된 시스템 프롬프트가 주어집니다:

```typescript
const buildSubsessionSystemPrompt = (config: {
  id: number;
  alias: string;
  description: string;
  context?: SubsessionContext;
  parentThreadId: string;
}) => `
## 역할
${config.description}

## 세션 정보
- ID: ${config.id}
- Alias: ${config.alias}
- 부모 스레드: ${config.parentThreadId}

${config.context ? `
## 컨텍스트
${config.context.background ? `### 배경\n${config.context.background}\n` : ''}
${config.context.relevant_files?.length ? `### 관련 파일\n${config.context.relevant_files.map(f => `- ${f}`).join('\n')}\n` : ''}
${config.context.constraints?.length ? `### 제약 조건\n${config.context.constraints.map(c => `- ${c}`).join('\n')}\n` : ''}
` : ''}

## 중요: 코드 변경 규칙

당신은 코드를 직접 수정할 수 있지만, 다음 규칙을 따르세요:

1. **분석/조사**: 자유롭게 수행
2. **코드 변경 전**: 반드시 메인에 승인 요청
   - ask_parent(type: "approval_request", message: "변경 계획...")
   - 승인 받은 후 진행
3. **메인이 명확히 지시한 경우**: 바로 수행 가능
   - 예: "src/auth.ts의 validateToken 함수 수정해"

## 사용 가능한 도구
- notify_parent: 부모에게 단방향 알림 (정보 전달, 경고)
- ask_parent: 부모에게 질문/승인 요청 (응답 대기)
- update_progress: 진행 상황 업데이트
- list_subsessions: 형제 세션 목록 확인 (읽기 전용)

> **Note**: 형제 세션 간 직접 통신은 지원하지 않습니다. 조율이 필요한 경우 메인 세션을 통해 처리합니다.

## 작업 완료
작업이 끝나면 결과가 자동으로 부모 세션에 전달됩니다.
`;
```

## Discord Display

### 메시지는 받는 쪽 스레드에 표시

**메인 스레드 (결과 받는 곳):**
```
┌─────────────────────────────────────┐
│ 📤 [code-analyst]에게 작업 위임      │
│ "src/ 디렉토리 구조 분석"            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 📥 [code-analyst] 결과 도착          │
│                                     │
│ src/ 하위 3개 모듈 발견:            │
│ • discord/ - Discord 클라이언트     │
│ • claude/ - Claude 세션 관리        │
│ • mcp/ - MCP 서버                   │
│                                     │
│ 서브 스레드: [Sub:code-analyst]     │
└─────────────────────────────────────┘
```

> 결과가 길 경우 요약만 표시하고, 전체 내용은 해당 서브세션 스레드에서 확인 가능

**서브 스레드 (작업 완료한 곳):**
```
┌─────────────────────────────────────┐
│ 📥 [메인] 작업 요청                  │
│ "src/ 디렉토리 구조 분석"            │
└─────────────────────────────────────┘

(서브세션이 작업 수행...)

┌─────────────────────────────────────┐
│ 📤 [메인]에게 결과 전송              │
└─────────────────────────────────────┘
```

### 상태 업데이트 (타임아웃 시)

```
┌─────────────────────────────────────┐
│ ⏳ [code-analyst] 작업 진행 중       │
│                                     │
│ 2분 경과 - 아직 작업 중입니다        │
│ 진행: "파일 35/45개 분석 완료"       │
└─────────────────────────────────────┘
```

## Type Definitions

### SessionInfo (Union Type)

메인 세션과 서브세션의 필드를 명확히 분리하여 타입 안전성을 확보합니다.

```typescript
// 공통 필드
interface BaseSessionInfo {
  sessionId: string;
  threadId: string;
  channelId: string;
  projectPath: string;
  query: Query | null;
  abortController: AbortController;
  lastActivityAt: number;
  isProcessing: boolean;
  mode: SessionMode;
  pendingPermission?: PendingPermission;
  pendingImages?: PendingImage[];
  messageQueue: QueuedMessage[];
}

// 메인 세션 전용
interface MainSessionInfo extends BaseSessionInfo {
  isSubsession: false;
  childSubsessions: Map<number, SubsessionState>;
  nextSubsessionId: number;  // 다음 서브세션 ID (자동 증가)
}

// 서브세션 전용
interface SubsessionSessionInfo extends BaseSessionInfo {
  isSubsession: true;
  subsessionId: number;       // 세션 내 고유 숫자 ID
  alias: string;              // 서브세션 식별자
  parentThreadId: string;     // 부모 스레드 ID
  lastResult?: string;        // 마지막 작업 결과
  progress?: string;          // 현재 진행 상황
}

// 유니온 타입
type SessionInfo = MainSessionInfo | SubsessionSessionInfo;

// 타입 가드
function isSubsession(session: SessionInfo): session is SubsessionSessionInfo {
  return session.isSubsession === true;
}

function isMainSession(session: SessionInfo): session is MainSessionInfo {
  return session.isSubsession === false;
}
```

### SubsessionContext

```typescript
interface SubsessionContext {
  relevant_files?: string[];
  background?: string;
  constraints?: string[];
}
```

### Inter-Session Message

```typescript
interface InterSessionMessage {
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
  summary: string;            // 결과 요약 (Discord 표시용, 작업 완료 주체가 생성)
  taskId?: string;
  waitingForResponse: boolean;
}
```

### Subsession Status

```typescript
type SubsessionStatus = 'idle' | 'working' | 'completed' | 'error';

interface SubsessionState {
  id: number;
  alias: string;
  threadId: string;
  status: SubsessionStatus;
  progress?: string;
  lastResult?: string;
  lastError?: string;
  createdAt: number;
  lastActivityAt: number;
  assignedPaths?: string[];   // 담당 파일/디렉토리 경로
}
```

## InterSessionBus

메모리 기반 메시지 버스 + Discord 표시.

> **Note**: `InterSessionBus`는 전역 싱글톤으로 구현됩니다. 모든 세션이 동일한 버스 인스턴스를 공유합니다.

```typescript
class InterSessionBus {
  // 메시지 큐 (메모리)
  private messageQueues: Map<string, InterSessionMessage[]> = new Map();

  // 대기 중인 작업 (타임아웃 체크용)
  private pendingTasks: Map<string, PendingTask> = new Map();

  // 응답 대기
  private pendingResponses: Map<string, PendingResponse> = new Map();

  // 세션 상태
  private sessionStates: Map<string, SubsessionState> = new Map();

  async delegateTask(
    parentThreadId: string,
    target: { id?: number; alias?: string },
    task: string,
    checkAfterMs: number = 120000
  ): Promise<string> {
    const taskId = generateId();

    // 1. 작업 전송 (메모리)
    await this.send({
      to: target,
      type: 'task',
      content: task,
      taskId
    });

    // 2. Discord에 표시 (서브 스레드에 작업 요청 표시)
    await this.displayInDiscord(targetThreadId, {
      type: 'task_received',
      from: 'main',
      content: task
    });

    // 3. 타임아웃 체크 스케줄링
    setTimeout(() => this.checkTaskTimeout(taskId), checkAfterMs);

    return taskId;
  }

  async onSubsessionComplete(taskId: string, result: string, summary: string) {
    // 1. 타이머 취소
    // 2. 메인에 결과 전송 (메모리)
    // 3. Discord에 표시 (메인 스레드에 결과 표시, 서브 스레드에 전송 표시)
  }
}
```

## Lifecycle

### 생성

- **메인 세션만** 서브세션을 생성할 수 있음 (서브세션은 서브세션 생성 불가)
- `create_subsession` MCP 도구 사용

### 사용자 직접 명령

- 사용자는 서브세션 스레드에서 직접 메시지를 보내 명령할 수 있음
- 서브세션은 사용자 명령을 메인 명령과 동일하게 처리
- 단, 서브세션 **생성**은 메인 세션만 가능

### 종료 조건

1. **명시적 종료**: 메인이 `close_subsession` 호출
2. **유휴 타임아웃**: 마지막 활동 후 24시간 경과 시 자동 종료

```typescript
const SUBSESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24시간
```

### 자동 종료 시 알림

서브세션이 자동 종료될 때 메인 세션에 알림을 전송합니다:

```typescript
interface SubsessionTerminationNotice {
  subsessionId: number;
  alias: string;
  reason: 'idle_timeout' | 'parent_terminated' | 'error';
  lastActivity: number;
  pendingTasks: string[];  // 완료되지 않은 작업 ID 목록
}

// 메인 스레드에 표시
// "⏹️ [code-analyst] 세션 종료됨 (24시간 유휴)"
// "미완료 작업: 없음" 또는 "미완료 작업: task-123, task-456"
```

**메인 세션이 이미 종료된 경우:**
- 서브세션도 함께 종료 (orphan 방지)
- Discord 스레드는 아카이브 처리
- 로그에 기록

## Resource Limits

```typescript
const SUBSESSION_LIMITS = {
  // 세션당 최대 서브세션 수
  MAX_SUBSESSIONS_PER_SESSION: 5,

  // 전체 시스템 최대 서브세션 수
  MAX_TOTAL_SUBSESSIONS: 20,

  // 서브세션 유휴 타임아웃 (24시간)
  IDLE_TIMEOUT_MS: 86400000,

  // 상태 체크 기본 타임아웃 (2분)
  DEFAULT_CHECK_AFTER_MS: 120000,
};
```

## Discord Rate Limit 대응

서브세션 생성 및 메시지 전송 시 Discord API rate limit을 고려해야 합니다.

```typescript
const DISCORD_RATE_LIMITS = {
  // 스레드 생성: 채널당 10개/10분 (보수적)
  threadCreationDelay: 1000,  // 스레드 생성 간 최소 1초 간격

  // 메시지 전송: 채널당 5개/5초
  messageQueueDelay: 200,     // 메시지 간 최소 200ms 간격
};

// 구현:
// - 스레드 생성 요청 큐잉
// - 메시지 전송 큐잉 (기존 messageQueue 활용)
// - 429 응답 시 Retry-After 헤더 존중
```

### 스레드 생성 큐 구현

스레드 생성은 기존 `messageQueue`와 별도로 구현합니다.

**파일 위치:** `src/discord/threadCreationQueue.ts`

```typescript
import { Client, TextChannel, ThreadChannel } from 'discord.js';

interface PendingThreadCreation {
  id: string;
  channelId: string;
  name: string;
  options: ThreadCreateOptions;
  resolve: (thread: ThreadChannel) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

class ThreadCreationQueue {
  private client: Client;
  private queue: PendingThreadCreation[] = [];
  private isProcessing = false;
  private lastCreationTime = 0;

  constructor(client: Client) {
    this.client = client;
  }

  // 최소 간격: 1초 (Discord rate limit 대응)
  private readonly MIN_INTERVAL_MS = 1000;
  // 최대 큐 크기
  private readonly MAX_QUEUE_SIZE = 50;
  // 타임아웃: 30초
  private readonly TIMEOUT_MS = 30000;

  async createThread(
    channelId: string,
    name: string,
    options: ThreadCreateOptions
  ): Promise<ThreadChannel> {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error('Thread creation queue is full');
    }

    return new Promise((resolve, reject) => {
      const item: PendingThreadCreation = {
        id: generateId(),
        channelId,
        name,
        options,
        resolve,
        reject,
        createdAt: Date.now()
      };

      // 타임아웃 설정
      setTimeout(() => {
        const index = this.queue.findIndex(i => i.id === item.id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Thread creation timeout'));
        }
      }, this.TIMEOUT_MS);

      this.queue.push(item);
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const elapsed = Date.now() - this.lastCreationTime;
      if (elapsed < this.MIN_INTERVAL_MS) {
        await sleep(this.MIN_INTERVAL_MS - elapsed);
      }

      const item = this.queue.shift()!;

      try {
        const channel = await this.client.channels.fetch(item.channelId);
        const thread = await (channel as TextChannel).threads.create({
          name: item.name,
          ...item.options
        });

        this.lastCreationTime = Date.now();
        item.resolve(thread);

      } catch (error) {
        if (this.isRateLimitError(error)) {
          // 429 에러: Retry-After 만큼 대기 후 재시도
          const retryAfter = this.getRetryAfter(error);
          await sleep(retryAfter);
          this.queue.unshift(item); // 다시 큐 앞에 추가
        } else {
          item.reject(error as Error);
        }
      }
    }

    this.isProcessing = false;
  }

  private isRateLimitError(error: unknown): boolean {
    return (error as any)?.status === 429;
  }

  private getRetryAfter(error: unknown): number {
    return ((error as any)?.retryAfter ?? 5) * 1000;
  }
}

// 싱글톤 인스턴스 (Discord client 초기화 후 설정)
let threadCreationQueue: ThreadCreationQueue;

export const initThreadCreationQueue = (client: Client) => {
  threadCreationQueue = new ThreadCreationQueue(client);
};

export { threadCreationQueue };
```

**사용 방법:**
```typescript
// 초기화 (Discord client ready 시점)
import { initThreadCreationQueue } from './threadCreationQueue';
initThreadCreationQueue(client);

// 기존 (직접 호출)
const thread = await channel.threads.create({ name: "[Sub:analyst]..." });

// 변경 (큐 통해 호출)
import { threadCreationQueue } from './threadCreationQueue';

const thread = await threadCreationQueue.createThread(
  channel.id,
  "[Sub:analyst] 작업 요청 제목",
  { autoArchiveDuration: 1440 }
);
```

## Alias Naming Rules

```typescript
const ALIAS_RULES = {
  // 허용: 영문 소문자, 숫자, 하이픈
  pattern: /^[a-z][a-z0-9-]{0,29}$/,

  // 최대 길이: 30자
  maxLength: 30,

  // 예약어 (사용 불가)
  reserved: ["main", "parent", "system", "all", "self", "me", "root"]
};
```

## File Structure

```
src/
├── mcp/
│   ├── subsessionServer.ts         # MCP 서버 메인
│   └── tools/
│       ├── index.ts                # 도구 등록
│       ├── createSubsession.ts     # 서브세션 생성 (메인 전용)
│       ├── delegateToSubsession.ts # 작업 위임 (메인 전용)
│       ├── checkSubsessionStatus.ts # 상태 확인 (메인 전용)
│       ├── closeSubsession.ts      # 서브세션 종료 (메인 전용)
│       ├── notifyParent.ts         # 부모에게 단방향 알림 (서브 전용)
│       ├── askParent.ts            # 부모에게 질문/승인 요청 (서브 전용)
│       ├── respondToSubsession.ts  # 서브세션 요청에 응답 (메인 전용, 내부)
│       ├── updateProgress.ts       # 진행 상황 업데이트 (서브 전용)
│       └── listSubsessions.ts      # 목록 조회 (공통)
├── claude/
│   ├── sessionManager.ts           # 기존 (확장)
│   └── interSessionBus.ts          # 세션 간 메시지 버스 (새로 추가)
├── discord/
│   ├── threadCreationQueue.ts     # 스레드 생성 큐 (rate limit 대응)
│   └── events/
│       ├── messageCreate.ts        # 메시지 소스 구분 추가
│       └── threadCreate.ts         # 서브세션 스레드 처리
└── types.ts                        # SessionInfo 유니온 타입
```

## Flow Example

```
User: "이 프로젝트 분석하고 리팩토링 계획 세워줘"

Main Session:
1. create_subsession({
     alias: "code-analyst",
     description: "코드베이스를 분석하고 구조를 파악합니다. 보안 취약점이나 개선점 발견 시 즉시 보고하세요.",
     context: {
       relevant_files: ["src/"],
       background: "Discord 봇 프로젝트"
     }
   })
   → Discord에 "[Sub:code-analyst] 프로젝트 분석" 스레드 생성
   → 반환: { id: 1, alias: "code-analyst", threadId: "..." }

2. delegate_to_subsession({ target: 1, task: "프로젝트 구조 분석해줘" })
   → 서브세션에 작업 전달
   → 메인은 다른 작업 가능

3. [2분 후 아직 완료 안됨]
   → 자동 상태 체크
   → 메인 스레드에 "⏳ 작업 진행 중" 표시

4. [서브세션 완료]
   → 결과 자동 Push
   → 메인 스레드에 "📥 결과 도착" 표시

5. 결과 받아서 리팩토링 계획 수립
```

## Error Recovery (에러 복구)

세션 간 통신 및 서브세션 장애 상황에 대한 복구 전략입니다.

### 서브세션 생존 조건

서브세션은 다음 조건을 모두 만족할 때 "살아있음":

```typescript
const isAlive = (session: SessionInfo) =>
  session.query !== null && !session.abortController.signal.aborted;
```

1. `query` 객체가 존재 (Claude Agent 연결됨)
2. `abortController.signal.aborted === false`

### 메시지 전송 실패

```typescript
interface MessageRetryConfig {
  maxRetries: 3,           // 최대 재시도 횟수
  retryDelayMs: 1000,      // 재시도 간격 (지수 백오프 적용)
  maxRetryDelayMs: 10000,  // 최대 재시도 간격
}

// 전송 실패 시:
// 1. 지수 백오프로 재시도 (1초 → 2초 → 4초)
// 2. 3회 실패 시 발신자에게 실패 알림
// 3. 메인 세션에 에러 상태 보고
```

### 서브세션 상태 체크

```typescript
const SESSION_CHECK_CONFIG = {
  // 작업 위임 전 1회 체크
  checkBeforeDelegate: true,

  // 작업 진행 중 주기적 체크 (3분)
  progressCheckIntervalMs: 180000,  // 3분

  // 체크 내용
  // - session.query !== null
  // - !session.abortController.signal.aborted
};
```

**체크 흐름:**
```
delegate_to_subsession 호출
    │
    ├─ [1] 위임 전 체크: 서브세션 alive 확인
    │      └─ 죽어있으면 → 에러 반환 "서브세션이 종료됨"
    │
    ├─ 작업 전달
    │
    └─ [2] 3분마다 체크 (작업 진행 중)
           ├─ 살아있음 → 계속 대기
           └─ 죽음 → 메인에 알림 "서브세션 종료됨"
```

### 서브세션 종료 감지

```
┌───────────────────────────────────────────────────────────┐
│                  서브세션 종료 감지                         │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  Agent SDK 기반 감지 (별도 heartbeat 불필요)               │
│                                                           │
│  종료 조건:                                               │
│  - session.query === null (Agent 연결 없음)              │
│  - abortController.signal.aborted === true (강제 종료)   │
│                                                           │
│  종료 감지 시 메인 세션에 알림:                            │
│  "⚠️ [code-analyst] 세션 종료됨"                          │
│                                                           │
│  복구 옵션 (메인 세션 판단):                               │
│  - 재시작: close_subsession → create_subsession          │
│  - 무시: 해당 작업 포기하고 다른 방법 시도                 │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### InterSessionBus 메시지 유실 방지

```typescript
interface PendingMessage {
  id: string;
  message: InterSessionMessage;
  sentAt: number;
  ackReceived: boolean;
  retryCount: number;
}

class InterSessionBus {
  // ACK 기반 전송 보장
  async sendWithAck(message: InterSessionMessage): Promise<boolean> {
    // 1. 메시지 전송
    // 2. ACK 대기 (타임아웃: 5초)
    // 3. ACK 미수신 시 재전송
    // 4. 3회 실패 시 false 반환 + 에러 로깅
  }
}
```

### 에러 상태 전파

```typescript
// 서브세션에서 에러 발생 시
interface SubsessionError {
  subsessionId: number;
  alias: string;
  errorType: 'crash' | 'timeout' | 'task_failed' | 'internal';
  message: string;
  taskId?: string;        // 실패한 작업 ID
  recoverable: boolean;   // 복구 가능 여부
  timestamp: number;
}

// 메인 세션에 자동 전달 → Discord에 표시
// "❌ [code-analyst] 에러 발생: 파일 읽기 권한 없음"
```

## File Conflict Prevention (동시성/경쟁 조건)

서브세션 간 파일 충돌을 방지하기 위해 **Orchestrator 협의 기반** 접근 방식을 사용합니다.

### 원칙

1. **서브세션은 동일한 파일을 동시에 수정하지 않음**
2. **메인(오케스트레이터)이 작업 영역을 명확히 분리하여 위임**
3. **경계가 불명확할 경우, 서브세션이 메인에 승인 요청 후 수정**

### 메인 세션의 책임

```
메인 세션은 작업 위임 시 다음을 명확히 해야 함:

1. 각 서브세션의 담당 파일/디렉토리 지정
2. 공유 파일이 있을 경우 수정 순서 조율
3. 겹치는 영역은 하나의 서브세션에만 할당

예시:
- delegate_task(id: 1, task: "src/auth/ 디렉토리 리팩토링")
- delegate_task(id: 2, task: "src/api/ 디렉토리 리팩토링")
- ❌ 두 서브세션 모두에 src/utils/ 수정 요청 → 충돌 위험
```

### 서브세션의 책임

```
서브세션은 코드 수정 전 다음을 확인:

1. 할당받은 파일/디렉토리 범위 내인지 확인
2. 범위 외 파일 수정 필요 시:
   - ask_parent(type: "approval_request",
       message: "src/utils/helper.ts 수정이 필요합니다. 다른 서브세션과 충돌 가능성 확인 부탁드립니다.")
   - 승인 후 수정
```

### 충돌 감지 및 해결

```typescript
// 메인 세션이 추적하는 파일 할당 정보
interface FileAssignment {
  subsessionId: number;
  paths: string[];           // 담당 경로 (glob 패턴 지원)
  exclusive: boolean;        // true: 독점, false: 읽기만 가능
}

// 충돌 발생 시 메인 세션의 판단:
// 1. 한 쪽에 양보 요청
// 2. 순차 실행으로 전환
// 3. 작업 병합 후 하나의 서브세션에 재할당
```

### 시스템 프롬프트에 포함

서브세션 생성 시 담당 영역이 시스템 프롬프트에 명시됨:

```typescript
context: {
  relevant_files: ["src/auth/**"],
  constraints: [
    "src/auth/ 디렉토리 내 파일만 수정 가능",
    "src/utils/ 파일 수정 필요 시 반드시 메인에 승인 요청"
  ]
}
```

## Future Considerations

### 1. Orphan 처리 (메인 세션 종료 후 서브세션 인계)

메인 세션이 종료되었을 때 서브세션을 어떻게 처리할지에 대한 전략입니다.

```
┌──────────────────────────────────────────────────────────────┐
│                    메인 세션 종료 시나리오                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Case 1: 정상 종료 (사용자가 명시적으로 세션 종료)              │
│  → 모든 서브세션에 종료 알림 전송                              │
│  → 서브세션 현재 작업 완료 대기 (타임아웃: 30초)               │
│  → 타임아웃 시 강제 종료 + 부분 결과 저장                      │
│                                                              │
│  Case 2: 비정상 종료 (crash, 네트워크 끊김 등)                 │
│  → Agent SDK 기반 감지 (query===null 또는 aborted===true)    │
│  → 선택지:                                                   │
│     A. 자동 종료: 서브세션도 함께 종료                         │
│     B. Orphan 유지: 서브세션을 다른 메인에 인계 가능 상태로 유지 │
│     C. 사용자 직접 관리: 사용자가 서브세션 스레드에서 직접 제어  │
│                                                              │
│  Case 3: 메인 세션 재시작                                     │
│  → 동일 threadId로 새 메인 세션 생성 시 orphan 서브세션 재연결  │
│  → list_subsessions로 기존 서브세션 확인 가능                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**구현 고려사항:**
- Orphan 서브세션 상태 저장 (Redis 또는 파일 기반)
- 인계 가능 시간 제한 (기본: 1시간)
- 인계 시 컨텍스트 복원 방법

### 2. 세션 우선순위 (부모 요청 vs 사용자 요청 충돌)

서브세션이 작업 중일 때 사용자가 직접 다른 요청을 보내면 어떻게 처리할지입니다.

```
┌──────────────────────────────────────────────────────────────┐
│                      우선순위 충돌 시나리오                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  상황: 서브세션이 메인의 delegate_task 처리 중                 │
│        사용자가 서브세션 스레드에 직접 메시지 전송              │
│                                                              │
│  옵션 1: 사용자 우선 (권장)                                   │
│  - 사용자 요청 즉시 처리                                      │
│  - 진행 중이던 작업은 일시 중지                                │
│  - 메인에 "사용자 개입으로 작업 중단됨" 알림                    │
│                                                              │
│  옵션 2: 부모 우선                                           │
│  - 사용자 요청을 큐에 저장                                    │
│  - 현재 작업 완료 후 처리                                     │
│  - 사용자에게 "작업 중, 완료 후 처리됩니다" 안내               │
│                                                              │
│  옵션 3: 사용자 선택                                         │
│  - 충돌 감지 시 버튼으로 선택 요청                            │
│  - "현재 작업 중단하고 요청 처리" vs "작업 완료 후 처리"        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**권장 정책:**
- 기본값: 사용자 우선 (사용자 경험 중시)
- 설정으로 변경 가능

### 3. 병렬 위임 (delegate_parallel)

여러 서브세션에 동시에 작업을 위임하고 결과를 집계하는 기능입니다.

```typescript
// 제안 도구
{
  name: "delegate_parallel",
  description: "여러 서브세션에 동시에 작업을 위임하고 모든 결과를 기다립니다.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            task: { type: "string" }
          }
        }
      },
      wait_mode: {
        type: "string",
        enum: ["all", "any", "first_success"],
        description: "all: 모두 완료 대기, any: 하나라도 완료 시 반환, first_success: 첫 성공 시 반환"
      },
      timeout_ms: { type: "number", default: 300000 }
    }
  },
  output_schema: {
    results: [
      { id: 1, status: "completed", result: "..." },
      { id: 2, status: "completed", result: "..." }
    ],
    aggregated_summary: "..."
  }
}

// 사용 예시
delegate_parallel({
  tasks: [
    { id: 1, task: "src/auth/ 분석" },
    { id: 2, task: "src/api/ 분석" },
    { id: 3, task: "src/utils/ 분석" }
  ],
  wait_mode: "all"
})
```

**활용 시나리오:**
- 대규모 코드베이스 동시 분석
- A/B 테스트 구현 비교
- 다중 파일 병렬 리팩토링

### 4. 분산 처리 (Multi-Server Support)

여러 서버에서 서브세션을 실행하여 부하 분산 및 확장성을 확보합니다.

```
┌──────────────────────────────────────────────────────────────┐
│                      분산 아키텍처                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│               ┌─────────────────┐                            │
│               │   Discord Bot    │                           │
│               │   (Coordinator)  │                           │
│               └────────┬────────┘                            │
│                        │                                     │
│            ┌───────────┼───────────┐                         │
│            │           │           │                         │
│            ▼           ▼           ▼                         │
│     ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│     │ Worker 1 │ │ Worker 2 │ │ Worker 3 │                   │
│     │ (Claude) │ │ (Claude) │ │ (Claude) │                   │
│     └──────────┘ └──────────┘ └──────────┘                   │
│                                                              │
│  InterSessionBus → Redis Pub/Sub 또는 Message Queue          │
│  Session State → Redis 또는 DB 저장                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**구현 요소:**
- Worker 등록/해제 메커니즘
- 작업 큐 및 부하 분산
- Cross-worker 메시지 전달 (Redis Pub/Sub)
- 상태 동기화 및 일관성 보장
