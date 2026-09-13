import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client';
import { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict, type VerdictSummary, resolveCacheDirOnSave, sameSettingValue, sectionForSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails } from './client-i18n.ts';
export type { Values } from './client-fields.ts';
export { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict, type VerdictSummary, resolveCacheDirOnSave, sameSettingValue, sectionForSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails, };
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
    usageIncomplete?: boolean;
    channelFallbacks?: number;
}
/** S05-A routing-cycle observation, as persisted on the record (all fields optional/lenient). */
export interface RouteObservationView {
    cycleId: string;
    trigger: string;
    stage: string;
    destination: string;
    attempt?: number;
    reservedCalls?: number;
    skipReason?: string;
    canceled?: boolean;
    usageIncomplete?: boolean;
    evidenceKept?: number;
    evidenceOmitted?: number;
    evidenceChars?: number;
    replayed?: string;
    generatedCalls?: number;
    judgeCalls?: number;
    sameCandidate?: boolean;
    alternativeAugmented?: boolean;
    alternativeModel?: string;
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
    route?: RouteObservationView;
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
        /**
         * Merge a patch into the stored section. Absent keys keep their stored
         * value, so this cannot undo an override.
         */
        update(ns: string, patch: Record<string, unknown>, expectedRevision: number | undefined): Promise<{
            ok: boolean;
            value: SettingsNamespaceView;
            error: {
                message: string;
            };
        }>;
        /**
         * Replace the stored section wholesale, so keys left out re-inherit the
         * composition base. Optional: a host without it falls back to 'update'
         * with every draft value pinned.
         */
        replace?(ns: string, section: Record<string, unknown>, expectedRevision: number | undefined): Promise<{
            ok: boolean;
            value: SettingsNamespaceView;
            error: {
                message: string;
            };
        }>;
    };
}
export interface JudgeProbeView {
    label: string;
    provider: string;
    model: string;
    ok: boolean;
    channel?: string;
    channelProbed?: boolean;
    scoreA?: number;
    scoreB?: number;
    latencyMs: number;
    calls?: number;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    error?: string;
}
export interface ProbeResultView {
    judges: JudgeProbeView[];
    channelProbed?: boolean;
    rubric: {
        source: string;
        count: number;
        file?: string;
        error?: string;
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
/** Poll interval of the process-selection chip while a turn runs (the answer is in-memory). */
export declare const PROCESS_ACTIVITY_POLL_MS = 1000;
/**
 * The chat-visible half of P06: what the bought cycle is doing while the reply is being buffered.
 *
 * Polls only while a read can change the answer — while the turn runs, and while a settled cycle is
 * still inside its server-side TTL — so an idle conversation makes no requests at all.
 * @param props - the input-dock owner values (the session snapshot) plus the injected RPC handle.
 */
export declare function ProcessActivityChip({ session, rpc }: {
    session?: {
        sessionId?: unknown;
        running?: unknown;
    } | null;
    rpc?: any;
}): import("react").JSX.Element | null;
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=client.d.ts.map