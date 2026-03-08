// MCP 도구 정의 및 실행 함수 export

// 메인 세션 전용 도구
export { createSubsessionTool, executeCreateSubsession } from './createSubsession.js';
export { delegateToSubsessionTool, executeDelegateToSubsession } from './delegateToSubsession.js';
export { checkSubsessionStatusTool, executeCheckSubsessionStatus } from './checkSubsessionStatus.js';
export { closeSubsessionTool, executeCloseSubsession } from './closeSubsession.js';
export { respondToSubsessionTool, executeRespondToSubsession } from './respondToSubsession.js';

// 서브세션 전용 도구
export { notifyParentTool, executeNotifyParent } from './notifyParent.js';
export { askParentTool, executeAskParent } from './askParent.js';
export { updateProgressTool, executeUpdateProgress } from './updateProgress.js';

// 공통 도구
export { listSubsessionsTool, executeListSubsessions } from './listSubsessions.js';

// 도구 목록
import { createSubsessionTool } from './createSubsession.js';
import { delegateToSubsessionTool } from './delegateToSubsession.js';
import { checkSubsessionStatusTool } from './checkSubsessionStatus.js';
import { closeSubsessionTool } from './closeSubsession.js';
import { respondToSubsessionTool } from './respondToSubsession.js';
import { notifyParentTool } from './notifyParent.js';
import { askParentTool } from './askParent.js';
import { updateProgressTool } from './updateProgress.js';
import { listSubsessionsTool } from './listSubsessions.js';

/**
 * 메인 세션용 도구 목록
 */
export const mainSessionTools = [
  createSubsessionTool,
  delegateToSubsessionTool,
  checkSubsessionStatusTool,
  closeSubsessionTool,
  respondToSubsessionTool,
  listSubsessionsTool,
];

/**
 * 서브세션용 도구 목록
 */
export const subsessionTools = [
  notifyParentTool,
  askParentTool,
  updateProgressTool,
  listSubsessionsTool,
];

/**
 * 모든 서브세션 관련 도구 이름 목록
 */
export const allSubsessionToolNames = [
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
