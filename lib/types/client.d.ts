import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client';
import { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict } from './client-i18n.ts';
export { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict };
interface VerifierRemote {
    session: {
        modelCatalog(): Promise<{
            ok: boolean;
            value: {
                groups: readonly ModelProviderGroup[];
                failures: readonly {
                    provider: string;
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
    sessionId: string;
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
export declare function StatisticsPage({ sessionId, rpc }: StatisticsPageProps): import("react").JSX.Element;
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=client.d.ts.map