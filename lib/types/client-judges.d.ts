export interface ExtraJudgeDraft {
    provider: string;
    model: string;
    reasoningEffort?: string;
    label?: string;
}
export declare const MAX_EXTRA_JUDGES = 4;
export declare function normalizeExtraJudges(value: unknown): ExtraJudgeDraft[];
export declare function judgeIdentity(provider: string, model: string): string;
export declare function judgeConflict(primary: {
    provider: string;
    model: string;
}, judges: readonly ExtraJudgeDraft[]): {
    index: number;
    duplicateOf: 'primary' | number;
} | undefined;
export declare function addExtraJudge(judges: readonly ExtraJudgeDraft[], draft: ExtraJudgeDraft): ExtraJudgeDraft[];
export declare function removeExtraJudge(judges: readonly ExtraJudgeDraft[], index: number): ExtraJudgeDraft[];
export declare function serializeExtraJudges(judges: readonly ExtraJudgeDraft[]): Array<Record<string, string>>;
//# sourceMappingURL=client-judges.d.ts.map