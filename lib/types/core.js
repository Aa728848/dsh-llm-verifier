/** Pure scoring and Probabilistic Pivot Tournament primitives. */
export const GRANULARITY = 20;
export const LETTERS = Array.from({ length: GRANULARITY }, (_, index) => String.fromCharCode(65 + index));
export const SCALE_DESCRIPTION = [
    'Rate how likely the agent correctly solved the task on a 20-point scale using letters A through T:',
    '  A = clearly and completely succeeded with verified output (best)',
    '  B-D = succeeded with only minor issues',
    '  E-G = above average, mostly correct with some issues',
    '  H-J = uncertain, leans toward success',
    '  K-M = uncertain, leans toward failure',
    '  N-P = below average, significant issues remain',
    '  Q-S = failed with some partial progress',
    '  T = clearly and completely failed (worst)',
].join('\n');
export const DEFAULT_CRITERIA = [
    {
        id: 'specification',
        name: 'Specification Adherence',
        description: 'Re-read the task description and check exact requirements: file paths, output formats, naming, and explicit constraints. Penalize a solution that solves a similar but different problem.',
    },
    {
        id: 'output_match',
        name: 'Output Match',
        description: 'Find the final verification command and compare its actual stdout/stderr to the required output. Reward only evidence literally visible in observed output; do not trust narration.',
    },
    {
        id: 'error_signals',
        name: 'Error Signal Detection',
        description: 'Scan especially later steps for unresolved errors, tracebacks, non-zero exits, command-not-found, missing files, compilation failures, and test failures. Score only unresolved error evidence.',
    },
];
export const DEFAULT_GROUND_TRUTH_NOTE = "**IMPORTANT:** Focus on observed tool and terminal output as ground truth. Do NOT trust the agent's self-assessment or claims of success.";
export function normalizeScoreLetter(token) {
    let value = token.trim();
    if (value.startsWith('>'))
        value = value.slice(1).trim();
    const match = /^([A-T])$/i.exec(value);
    return match?.[1]?.toUpperCase();
}
function letterValue(letter) {
    return GRANULARITY - (letter.charCodeAt(0) - 65);
}
function findTagLogprobs(tokens, positions, tag) {
    if (tokens.length === 0 || positions.length === 0)
        return undefined;
    for (const suffix of [tag, tag.slice(0, -1)]) {
        let found;
        let text = '';
        for (let index = 0; index < tokens.length; index += 1) {
            text += tokens[index];
            if (text.trimEnd().endsWith(suffix) && index + 1 < positions.length)
                found = positions[index + 1];
        }
        if (found !== undefined)
            return found;
    }
    return undefined;
}
export function extractScore(completion, tag) {
    const alternatives = findTagLogprobs(completion.tokens, completion.positions, tag);
    const probabilities = new Map();
    for (const alternative of alternatives ?? []) {
        const letter = normalizeScoreLetter(alternative.token);
        if (letter === undefined || !Number.isFinite(alternative.logprob))
            continue;
        const value = letterValue(letter);
        probabilities.set(value, Math.max(probabilities.get(value) ?? 0, Math.exp(alternative.logprob)));
    }
    if (probabilities.size > 0) {
        let probability = 0;
        let expectation = 0;
        for (const [value, p] of probabilities) {
            probability += p;
            expectation += value * p;
        }
        if (probability > 0)
            return (expectation / probability - 1) / (GRANULARITY - 1);
    }
    const name = tag.slice(1, -1);
    const regex = new RegExp('<' + name + '>\\s*(.+?)\\s*</' + name + '>', 'gi');
    let last = null;
    for (let match = regex.exec(completion.text); match !== null; match = regex.exec(completion.text))
        last = match;
    const letter = normalizeScoreLetter(last?.[1] ?? '');
    if (letter === undefined)
        throw new Error('llm-verifier: verifier response did not contain a valid ' + tag + ' A-T score');
    return (letterValue(letter) - 1) / (GRANULARITY - 1);
}
export function buildPairwisePrompt(problem, traceA, traceB, criterion, groundTruthNote = DEFAULT_GROUND_TRUTH_NOTE) {
    return [
        'You are an expert evaluator of AI coding agents. You will see a task description and two agent trajectories, then evaluate them on ONE specific criterion, stated at the end.',
        groundTruthNote,
        '**Task:**\n' + problem,
        '**Trajectory A:**\n' + traceA,
        '**Trajectory B:**\n' + traceB,
        '**Rating Scale:**\n' + SCALE_DESCRIPTION,
        '**Evaluation Guideline — ' + criterion.name + ':**\n' + criterion.description,
        'Score each trajectory ONLY on this specific criterion ("' + criterion.name + '"). Ignore other aspects that are not relevant to it.',
        'Reason it through first, then END your reply with exactly these two lines and nothing after them. Replace each placeholder with a single letter A-T, keeping the spaces around the letter exactly as shown:\n<score_A> LETTER_A_TO_T </score_A>\n<score_B> LETTER_A_TO_T </score_B>',
        'Begin your analysis now.',
    ].join('\n\n');
}
export function buildProgressPrompt(problem, steps, checkpoints) {
    const trajectory = steps.map((step, index) => '=== Agent Step ' + (index + 1) + ' ===\n' + step.trim()).join('\n\n');
    const tags = checkpoints.map((_, index) => '<c' + (index + 1) + '>LETTER</c' + (index + 1) + '>').join('\n');
    return [
        "You are a strict, skeptical evaluator of agent task attempts. Trust observed output — NOT the agent's narration.",
        '**Task instruction:**\n' + problem.trim(),
        '**Agent trajectory (' + steps.length + ' agent steps):**\n' + trajectory,
        "Score whether the agent's CURRENT state at each checkpoint would actually satisfy the task's hidden grader.",
        'Use A through T where A = certainly NO, H-M = uncertain, N-S = leans YES, and T = essentially certain YES with matching observed verification.',
        'Effort and confident narration are not evidence. A state without real verification should not exceed K. Scores may decrease after regressions.',
        'The checkpoints are:\n' + checkpoints.map((step, index) => '  Checkpoint ' + (index + 1) + ' = state right after Agent Step ' + step).join('\n'),
        'Output EXACTLY these lines and nothing else:\n' + tags,
    ].join('\n\n');
}
/** Progress uses A=NO..T=YES, the reverse of pairwise success scoring. */
export function extractProgressScore(completion, tag) {
    return 1 - extractScore(completion, tag);
}
export function bradleyTerry(rewardA, rewardB) {
    return 1 / (1 + Math.exp(-(rewardA - rewardB)));
}
export function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}
export function ringCycle(count, seed = 0) {
    if (count <= 1)
        return [];
    const permutation = Array.from({ length: count }, (_, index) => index);
    const random = seededRandom(seed);
    for (let index = count - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [permutation[index], permutation[other]] = [permutation[other], permutation[index]];
    }
    return permutation.map((candidate, index) => [candidate, permutation[(index + 1) % count]]);
}
export function pivotRoundPairs(count, pivots) {
    const pivotSet = new Set(pivots);
    const pairs = [];
    for (let candidate = 0; candidate < count; candidate += 1) {
        if (!pivotSet.has(candidate))
            for (const pivot of pivots)
                pairs.push([candidate, pivot]);
    }
    const sorted = [...pivots].sort((a, b) => a - b);
    for (let left = 0; left < sorted.length; left += 1) {
        for (let right = left + 1; right < sorted.length; right += 1)
            pairs.push([sorted[left], sorted[right]]);
    }
    return pairs;
}
export function accumulatePairs(pairs, rewards, wins, counts) {
    for (const [a, b] of pairs) {
        const reward = rewards.get(a + ',' + b) ?? [0.5, 0.5];
        const probability = bradleyTerry(reward[0], reward[1]);
        wins[a] = (wins[a] ?? 0) + probability;
        counts[a] = (counts[a] ?? 0) + 1;
        wins[b] = (wins[b] ?? 0) + 1 - probability;
        counts[b] = (counts[b] ?? 0) + 1;
    }
}
export function topPivots(wins, counts, requested) {
    return Array.from({ length: wins.length }, (_, index) => index)
        .sort((a, b) => ((wins[b] ?? 0) / (counts[b] || 1)) - ((wins[a] ?? 0) / (counts[a] || 1)) || a - b)
        .slice(0, Math.min(requested, wins.length));
}
export function rankScores(wins, counts) {
    return Array.from({ length: wins.length }, (_, index) => ({ index, score: (wins[index] ?? 0) / (counts[index] || 1) }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
}
//# sourceMappingURL=core.js.map