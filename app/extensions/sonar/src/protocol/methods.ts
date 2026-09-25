/**
 * DouyinClient 能力的方法名注册表（设计文档第 6 节）。
 *
 * 这是协议的「已知方法」白名单：跨上下文消息中出现不在此列表的方法名必须显式失败，
 * 不能静默忽略。这里是纯数据声明。
 */
export const METHOD_NAMES = [
  // 页面与采集
  'detectCurrentPage',
  'getCreator',
  'getCreatorBySecUid',
  'listCreatorVideos',
  'listRecentVideos',
  'collectCreatorFully',
  'getCollectProgress',
  // 解析与下载
  'resolveVideo',
  'downloadVideo',
  'getDownloadTask',
  'cancelDownload',
  // 博主收藏与监控
  'followCreator',
  'unfollowCreator',
  'listFollowedCreators',
  'runMonitorOnce',
  // 媒体处理（转录 + 摘要）
  'processVideo',
  'getProcessingTask',
  'cancelProcessingTask',
  'getTranscript',
  'regenerateTranscript',
  'getAnalysis',
  'listAnalyses',
  'regenerateAnalysis',
  // 导出与工作流（创作流水线）
  'exportMarkdown',
  'addToWorkflow',
  'listWorkflowItems',
  'retryWorkflowItem',
  'removeWorkflowItem',
  'pushWorkflowItem',
  // AI 设置
  'getAiSettings',
  'updateAiSettings',
  'testAiProvider',
  // 桥（灵机剪影联动）
  'getBridgeSettings',
  'updateBridgeSettings',
  'testBridge',
  'pushVideoToBridge',
  'autoConnectBridge',
] as const;

export type MethodName = (typeof METHOD_NAMES)[number];

/** 已知方法名集合（数据），供协议解码做成员判断。 */
export const METHOD_SET: ReadonlySet<string> = new Set(METHOD_NAMES);
