#!/usr/bin/env node
/**
 * Offline replay of recorded verifier decisions.
 *
 * Two questions, both answerable without a single model call:
 *
 *  1. What would a different acceptance threshold have decided? Every stored
 *     `verifier_current_session` record carries the session score, the empty-work baseline, the
 *     winner and the per-criterion scores — everything the gate looked at — so the live
 *     acceptance rule can be re-applied at any threshold.
 *  2. Do the captured judge answers still parse to the scores they produced? A decision snapshot
 *     keeps the raw answer, so the current parser is replayed against it and any drift is a
 *     prompt/parser regression.
 *
 * Usage:
 *   pnpm run build                                  # the script imports lib/replay.js
 *   node scripts/eval-replay.mjs                    # every topic under ~/.dsh/sessions
 *   node scripts/eval-replay.mjs --dir <topic-dir>  # one topic directory (repeatable)
 *   node scripts/eval-replay.mjs --thresholds 0.5,0.65,0.8
 *   node scripts/eval-replay.mjs --json
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseStatisticsRecords, replayDecisionScores, sweepThresholds } from '../lib/replay.js'

const DEFAULT_THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9]

function parseArgs(argv) {
  const options = { dirs: [], thresholds: DEFAULT_THRESHOLDS, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dir') { const value = argv[index + 1]; if (value) { options.dirs.push(value); index += 1 } }
    else if (arg === '--thresholds') {
      const value = argv[index + 1]
      if (value) {
        const parsed = value.split(',').map(entry => Number(entry.trim())).filter(entry => Number.isFinite(entry) && entry >= 0 && entry <= 1)
        if (parsed.length > 0) options.thresholds = parsed
        index += 1
      }
    } else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') { console.log('usage: node scripts/eval-replay.mjs [--dir <topic-dir>]... [--thresholds 0.5,0.65] [--json]'); process.exit(0) }
  }
  return options
}

/** Every `verifier` directory under a topic root, or the root itself when it is one. */
function findVerifierDirs(root) {
  const found = []
  const visit = (directory, depth) => {
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    if (directory.endsWith('verifier')) { found.push(directory); return }
    if (depth > 3) return
    for (const entry of entries) if (entry.isDirectory()) visit(join(directory, entry.name), depth + 1)
  }
  try { if (statSync(root).isDirectory()) visit(root, 0) } catch { /* missing root: no data */ }
  return found
}

function readIfPresent(file) {
  try { return readFileSync(file, 'utf8') } catch { return undefined }
}

const options = parseArgs(process.argv.slice(2))
const roots = options.dirs.length > 0 ? options.dirs : [join(homedir(), '.dsh', 'sessions')]
const dirs = roots.flatMap(findVerifierDirs)

const invocations = []
const decisions = []
for (const directory of dirs) {
  const statistics = readIfPresent(join(directory, 'statistics-v1.json'))
  if (statistics !== undefined) invocations.push(...parseStatisticsRecords(statistics))
  const decisionsText = readIfPresent(join(directory, 'decisions-v1.json'))
  if (decisionsText === undefined) continue
  try {
    const document = JSON.parse(decisionsText)
    for (const record of Array.isArray(document.records) ? document.records : []) {
      for (const call of Array.isArray(record.calls) ? record.calls : []) decisions.push(call)
    }
  } catch { /* an unreadable snapshot file is not a reason to fail the replay */ }
}

const rows = sweepThresholds(invocations, options.thresholds)
const replay = replayDecisionScores(decisions)
const byChannel = new Map()
for (const row of replay) {
  const bucket = byChannel.get(row.channel) ?? { channel: row.channel, match: 0, drift: 0, unreadable: 0, 'not-scored': 0 }
  bucket[row.mode] += 1
  byChannel.set(row.channel, bucket)
}

if (options.json) {
  console.log(JSON.stringify({ topics: dirs.length, invocations: invocations.length, thresholds: rows, parser: [...byChannel.values()] }, null, 2))
} else {
  console.log('LLM verifier offline replay')
  console.log('  topics scanned     ' + dirs.length)
  console.log('  invocations        ' + invocations.length)
  console.log('')
  console.log('  threshold |  total | accepted | mean-short | criterion-short | verdict | unscored')
  console.log('  ----------+--------+----------+------------+-----------------+---------+---------')
  for (const row of rows) {
    console.log('  ' + row.threshold.toFixed(3).padEnd(9) + ' | ' + String(row.total).padStart(6) + ' | ' + String(row.accepted).padStart(8) + ' | ' + String(row.rejectedMean).padStart(10) + ' | ' + String(row.rejectedCriterion).padStart(15) + ' | ' + String(row.rejectedVerdict).padStart(7) + ' | ' + String(row.unscored).padStart(8))
  }
  console.log('  (criterion-short = the mean passed but the per-criterion floor rejected it)')
  console.log('')
  console.log('  parser replay of ' + replay.length + ' captured judge answers:')
  if (replay.length === 0) console.log('    no decision snapshots found (capture disabled, or nothing captured yet)')
  for (const bucket of byChannel.values()) {
    console.log('    ' + bucket.channel.padEnd(14) + 'match ' + String(bucket.match).padStart(4) + '  drift ' + String(bucket.drift).padStart(4) + '  unreadable ' + String(bucket.unreadable).padStart(4) + '  not-scored ' + String(bucket['not-scored']).padStart(4))
  }
  const drifted = replay.filter(row => row.mode === 'drift' && row.channel !== 'top-logprobs').slice(0, 10)
  for (const row of drifted) console.log('    drift: ' + row.label + ' stored ' + row.stored + ' -> reparsed ' + row.reparsed)
  console.log('')
  console.log('  (not-scored = route classifications and other answers that carry no score tag by design)')
  console.log('  note: a top-logprobs score is an expectation over a token distribution the snapshot')
  console.log('  does not keep, so its text-channel re-parse is expected to differ.')
}
