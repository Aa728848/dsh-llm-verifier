import { sanitizeVerifierText } from "./session.js";
export function detectPlanExit(events, fromSeq = 0) {
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.seq < fromSeq)
            break;
        if (event.type === 'tool/call' && event.data.name === 'exit_plan_mode') {
            let planText = '';
            try {
                const parsed = JSON.parse(event.data.arguments);
                if (typeof parsed.plan === 'string' && parsed.plan.trim()) {
                    planText = parsed.plan.trim();
                }
            }
            catch { }
            if (!planText) {
                for (let j = i - 1; j >= 0; j--) {
                    const prev = events[j];
                    if (prev.seq < fromSeq)
                        break;
                    if (prev.type === 'assistant/message') {
                        const msg = prev.data.message;
                        if (Array.isArray(msg?.content)) {
                            const texts = msg.content
                                .filter((b) => b.type === 'text')
                                .map(b => b.text);
                            if (texts.length > 0) {
                                planText = texts.join('\n').trim();
                                break;
                            }
                        }
                    }
                }
            }
            return { hasExitPlanMode: true, callSeq: event.seq, planText };
        }
    }
    return { hasExitPlanMode: false };
}
export function buildPlanPreReviewPrompt(problem, planText, maxChars = 20000) {
    return [
        'You are an expert independent technical plan verifier. A candidate implementation plan was submitted for human review.',
        'Evaluate whether the plan is sound, executable, and comprehensive.',
        'Scoring criteria:',
        'A: Flawless, thorough, with clear steps, rigorous verification, edge cases handled.',
        'B-J: Mostly sound, minor gaps or nuances missing.',
        'K-S: Noticeable architectural gaps, missing regression checks, or ambiguities.',
        'T: Fundamentally flawed, dangerous, or missing core requirements.',
        '',
        'Task requirement:',
        sanitizeVerifierText(problem, 4000),
        '',
        'Proposed Plan:',
        sanitizeVerifierText(planText, maxChars),
        '',
        'Output format:',
        'Line 1: Verdict: <Single uppercase letter A-T>',
        'Line 2: Summary: <One sentence assessment>',
        'Line 3+: Key strengths, blind spots, and verification guidance.',
    ].join('\n\n');
}
export function parsePlanReviewVerdict(text) {
    const match = /Verdict:\s*([A-T])/i.exec(text);
    const verdict = match ? match[1].toUpperCase() : 'B';
    // A is 1.0, T is 0.0
    const index = verdict.charCodeAt(0) - 65;
    const score = Math.max(0, Math.min(1, 1 - index / 19));
    return { verdict, score, feedback: text.trim() };
}
//# sourceMappingURL=plan-gate.js.map