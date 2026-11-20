// src/shared/fork/quick-task-contract.ts
// SLRM-2428: the one call desktop, phone and CLI use to hand a quick task to the router bot.
export const QUICK_TASK_SUBMIT_METHOD = 'quickTask.submit' as const
export const QUICK_TASK_TEXT_MAX = 8000
export type QuickTaskSource = 'desktop' | 'mobile' | 'cli'
export type QuickTaskSubmitParams = { text: string; source: QuickTaskSource }
export type QuickTaskSubmitResult = { botName: string; chatId: string | null; note: string }
