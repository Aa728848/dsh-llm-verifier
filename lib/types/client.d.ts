import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client';
import { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict, type VerdictSummary, resolveCacheDirOnSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails } from './client-i18n.ts';
import { type ExtraJudgeDraft } from './client-judges.ts';
export { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict, type VerdictSummary, resolveCacheDirOnSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails, };
export interface Values {
    enabled: boolean;
    autoVerifyMode: 'manual' | 'smart' | 'strict';
    autoVerifyThreshold: number;
    autoVerifyRepeats: number;
    autoVerifyFinalRepeats: number;
    autoVerifyMinToolCalls: number;
    autoVerifyMaxChars: number;
    autoVerifyMaxPerTask: number;
    autoVerifyMaxPerSession: number;
    autoRouteSemantic: boolean;
    autoRouteMinConfidence: number;
    autoRouteMaxCandidates: number;
    autoRouteMaxPerTask: number;
    autoRouteMaxPerSession: number;
    autoTrackCompletionThreshold: number;
    autoRouteMaxItemChars: number;
    autoRouteMaxInputChars: number;
    autoMaxModelCallsPerTask: number;
    autoMaxModelCallsPerSession: number;
    autoVerifyTeamTasks: boolean;
    autoVerifyPlanMode: boolean;
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens: number;
    temperature: number;
    label?: string;
    maxConcurrency: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    timeoutMs: number;
    cacheDir: string;
    cacheMaxEntries: number;
    estimatedInputUsdPerMillion: number;
    estimatedOutputUsdPerMillion: number;
    autoVerifySubagents: boolean;
    extraJudges: ExtraJudgeDraft[];
}
export interface Loaded {
    groups: readonly ModelProviderGroup[];
    settings: SettingsNamespaceView;
    writable: boolean;
    failures: string[];
}
export interface RunStats {
    calls: number;
    attempts: number;
    retries: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheHits: number;
    cacheMisses: number;
    estimatedCostUsd: number;
    topLogprobScores: number;
    explicitTagScores: number;
}
export interface InvocationRecord {
    id: string;
    toolName: string;
    sessionId?: string;
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    success: boolean;
    errorName?: string;
    errorMessage?: string;
    provider: string;
    model: string;
    stats: RunStats;
    verdict?: VerdictSummary;
}
interface VerifierRemote {
    session: {
        modelCatalog(): Promise<{
            ok: boolean;
            value: {
                groups: readonly ModelProviderGroup[];
                failures: readonly {
                    id?: string;
                    provider?: string;
                    name?: string;
                    message: string;
                }[];
            };
            error: {
                message: string;
            };
        }>;
    };
    settings: {
        describe(): Promise<{
            ok: boolean;
            value: {
                writable: boolean;
                namespaces: readonly SettingsNamespaceView[];
            };
            error: {
                message: string;
            };
        }>;
        update(ns: string, patch: Record<string, unknown>, expectedRevision: number | undefined): Promise<{
            ok: boolean;
            value: SettingsNamespaceView;
            error: {
                message: string;
            };
        }>;
    };
}
interface VerifierSettingsProps {
    remote: VerifierRemote;
}
interface StatisticsPageProps {
    sessionId?: string;
    isGlobal?: boolean;
    rpc: {
        call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
            ok: boolean;
            value?: unknown;
            error?: {
                message: string;
            };
        }>;
    };
}
export declare function VerifierSettings({ remote }: VerifierSettingsProps): import("react").JSX.Element;
export declare function StatisticsPage({ sessionId, rpc, isGlobal }: StatisticsPageProps): import("react").JSX.Element;
export declare function VerifierSidebarIcon({ size, active }: {
    size: number;
    active?: boolean;
}): import("react").JSX.Element;
export declare function GlobalVerifierDashboard({ rpc }: {
    rpc: any;
}): import("react").JSX.Element;
export declare function RightSidebarVerifierPanel({ rpc, sessionId }: {
    rpc: any;
    sessionId?: string;
}): import("react").JSX.Element;
export declare function RightSidebarVerifierTitle(): import("react").JSX.Element;
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=client.d.ts.map