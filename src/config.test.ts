import { describe, expect, it } from 'vitest'
import { Config, MAX_EXTRA_JUDGES, resolveConfig } from './config.ts'
import { serializeExtraJudges, type ExtraJudgeDraft } from './client-judges.ts'

describe('config - judges ensemble resolution', () => {
  it('default/empty extraJudges produces judges of length 1 identical to primary, with reasoningEffort absent when unset', () => {
    const resDefault = resolveConfig({})
    expect(resDefault.judges).toHaveLength(1)
    expect(resDefault.judges[0]).toEqual({
      provider: resDefault.provider,
      model: resDefault.model,
      maxTokens: resDefault.maxTokens,
      label: resDefault.model,
    })
    expect('reasoningEffort' in resDefault.judges[0]).toBe(false)
    expect(resDefault.judges[0].provider).toBe('deepseek-official')
    expect(resDefault.judges[0].model).toBe('deepseek-flash')
    expect(resDefault.judges[0].maxTokens).toBe(32768)
    expect(resDefault.judges[0].label).toBe('deepseek-flash')

    const resEmptyArray = resolveConfig({ extraJudges: [] })
    expect(resEmptyArray.judges).toHaveLength(1)
    expect(resEmptyArray.judges[0]).toEqual(resDefault.judges[0])

    const resPrimaryWithEffort = resolveConfig({ reasoningEffort: 'high' })
    expect(resPrimaryWithEffort.judges).toHaveLength(1)
    expect(resPrimaryWithEffort.judges[0]).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'high',
      maxTokens: 32768,
      label: 'deepseek-flash',
    })
  })

  it('one extra judge resolves in order [primary, extra], inherits primary maxTokens, and keeps own effort', () => {
    const res = resolveConfig({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      maxTokens: 16000,
      reasoningEffort: 'high',
      extraJudges: [
        {
          provider: 'openai',
          model: 'gpt-4o',
          reasoningEffort: 'low',
        },
      ],
    })

    expect(res.judges).toHaveLength(2)
    expect(res.judges[0]).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'high',
      maxTokens: 16000,
      label: 'deepseek-flash',
    })
    expect(res.judges[1]).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      reasoningEffort: 'low',
      maxTokens: 16000,
      label: 'gpt-4o',
    })

    // When extra judge does not specify reasoningEffort, it does NOT inherit primary's effort
    const resNoExtraEffort = resolveConfig({
      reasoningEffort: 'high',
      extraJudges: [
        {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
        },
      ],
    })
    expect(resNoExtraEffort.judges[1].reasoningEffort).toBeUndefined()
    expect('reasoningEffort' in resNoExtraEffort.judges[1]).toBe(false)

    // When extra judge specifies own maxTokens, it overrides the primary
    const resOwnTokens = resolveConfig({
      maxTokens: 16000,
      extraJudges: [
        {
          provider: 'openai',
          model: 'gpt-4o',
          maxTokens: 8192,
        },
      ],
    })
    expect(resOwnTokens.judges[0].maxTokens).toBe(16000)
    expect(resOwnTokens.judges[1].maxTokens).toBe(8192)
  })

  it('applies label defaulting and collision suffixing (#2, #3)', () => {
    // Explicit label on extra judge is used when given
    const resExplicit = resolveConfig({
      extraJudges: [
        { provider: 'openai', model: 'gpt-4o', label: 'My Judge' },
      ],
    })
    expect(resExplicit.judges[1].label).toBe('My Judge')

    // Model name collision: primary label defaults to model name, extra judge with same model falls back to provider/model
    const resModelCollision = resolveConfig({
      provider: 'deepseek-official',
      model: 'shared-model',
      extraJudges: [
        { provider: 'custom-provider', model: 'shared-model' },
      ],
    })
    expect(resModelCollision.judges[0].label).toBe('shared-model')
    expect(resModelCollision.judges[1].label).toBe('custom-provider/shared-model')

    // Fallback collision: when fallback (provider/model) is also already taken, appends #2, #3
    const resFallbackCollision = resolveConfig({
      provider: 'p1',
      model: 'm1',
      label: 'p2/m2', // primary intentionally takes p2/m2
      extraJudges: [
        { provider: 'p2', model: 'm2', label: 'p2/m2' }, // candidate p2/m2 taken -> fallback p2/m2 taken -> #2
        { provider: 'p3', model: 'm3', label: 'p2/m2' }, // candidate p2/m2 taken -> fallback p3/m3 unused -> p3/m3
      ],
    })
    expect(resFallbackCollision.judges[0].label).toBe('p2/m2')
    expect(resFallbackCollision.judges[1].label).toBe('p2/m2#2')
    expect(resFallbackCollision.judges[2].label).toBe('p3/m3')

    // Suffixing advances past #2 to #3 if #2 is also already taken
    const resSuffix3 = resolveConfig({
      provider: 'p1',
      model: 'm1',
      label: 'p2/m2',
      extraJudges: [
        { provider: 'p0', model: 'm0', label: 'p2/m2#2' }, // takes #2 explicitly
        { provider: 'p2', model: 'm2', label: 'p2/m2' }, // candidate taken, fallback taken, #2 taken -> #3
      ],
    })
    expect(resSuffix3.judges[0].label).toBe('p2/m2')
    expect(resSuffix3.judges[1].label).toBe('p2/m2#2')
    expect(resSuffix3.judges[2].label).toBe('p2/m2#3')
  })

  it('throws on duplicate provider+model (including duplicate of primary and effort-insensitive)', () => {
    // Duplicating primary provider + model throws
    expect(() =>
      resolveConfig({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        extraJudges: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
      }),
    ).toThrow(/llm-verifier: duplicate judge.*deepseek-official\/deepseek-flash/)

    // Duplicating primary with different reasoningEffort still throws (effort-insensitive identity)
    expect(() =>
      resolveConfig({
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'low',
        extraJudges: [
          {
            provider: 'deepseek-official',
            model: 'deepseek-flash',
            reasoningEffort: 'high',
          },
        ],
      }),
    ).toThrow(/llm-verifier: duplicate judge.*deepseek-official\/deepseek-flash/)

    // Duplicating across extra judges throws
    expect(() =>
      resolveConfig({
        extraJudges: [
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'openai', model: 'gpt-4o' },
        ],
      }),
    ).toThrow(/llm-verifier: duplicate judge.*openai\/gpt-4o/)

    // Whitespace-trimmed duplicate check
    expect(() =>
      resolveConfig({
        extraJudges: [
          { provider: 'openai', model: 'gpt-4o' },
          { provider: ' openai ', model: ' gpt-4o ' },
        ],
      }),
    ).toThrow(/llm-verifier: duplicate judge.*openai\/gpt-4o/)
  })

  it('accepts exactly MAX_EXTRA_JUDGES and throws on MAX_EXTRA_JUDGES + 1', () => {
    expect(MAX_EXTRA_JUDGES).toBe(4)

    // Exactly MAX_EXTRA_JUDGES extras is accepted
    const resMax = resolveConfig({
      extraJudges: [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
        { provider: 'p4', model: 'm4' },
      ],
    })
    expect(resMax.judges).toHaveLength(5)
    expect(resMax.judges.map(j => j.model)).toEqual([
      'deepseek-flash',
      'm1',
      'm2',
      'm3',
      'm4',
    ])

    // MAX_EXTRA_JUDGES + 1 throws
    expect(() =>
      resolveConfig({
        extraJudges: [
          { provider: 'p1', model: 'm1' },
          { provider: 'p2', model: 'm2' },
          { provider: 'p3', model: 'm3' },
          { provider: 'p4', model: 'm4' },
          { provider: 'p5', model: 'm5' },
        ],
      }),
    ).toThrow(/llm-verifier: extraJudges cannot exceed 4/)
  })

  it('throws on bad input naming failing index', () => {
    // Empty or missing provider on extra judge
    expect(() =>
      resolveConfig({
        extraJudges: [{ provider: '', model: 'm' }],
      }),
    ).toThrow('llm-verifier: extraJudges[0].provider must be non-empty')

    expect(() =>
      resolveConfig({
        extraJudges: [{ provider: '   ', model: 'm' }],
      }),
    ).toThrow('llm-verifier: extraJudges[0].provider must be non-empty')

    expect(() =>
      resolveConfig({
        extraJudges: [{ model: 'm' } as any],
      }),
    ).toThrow('llm-verifier: extraJudges[0].provider must be non-empty')

    // Empty or missing model on extra judge at index 1
    expect(() =>
      resolveConfig({
        extraJudges: [
          { provider: 'p1', model: 'm1' },
          { provider: 'p2', model: '' },
        ],
      }),
    ).toThrow('llm-verifier: extraJudges[1].model must be non-empty')

    expect(() =>
      resolveConfig({
        extraJudges: [
          { provider: 'p1', model: 'm1' },
          { provider: 'p2', model: '  ' },
        ],
      }),
    ).toThrow('llm-verifier: extraJudges[1].model must be non-empty')

    expect(() =>
      resolveConfig({
        extraJudges: [
          { provider: 'p1', model: 'm1' },
          { provider: 'p2' } as any,
        ],
      }),
    ).toThrow('llm-verifier: extraJudges[1].model must be non-empty')

    // maxTokens 0, 1.5, NaN, negative
    expect(() =>
      resolveConfig({
        extraJudges: [{ provider: 'p', model: 'm', maxTokens: 0 }],
      }),
    ).toThrow('llm-verifier: extraJudges[0].maxTokens must be a positive safe integer')

    expect(() =>
      resolveConfig({
        extraJudges: [{ provider: 'p', model: 'm', maxTokens: 1.5 }],
      }),
    ).toThrow('llm-verifier: extraJudges[0].maxTokens must be a positive safe integer')

    expect(() =>
      resolveConfig({
        extraJudges: [{ provider: 'p', model: 'm', maxTokens: NaN }],
      }),
    ).toThrow('llm-verifier: extraJudges[0].maxTokens must be a positive safe integer')

    expect(() =>
      resolveConfig({
        extraJudges: [{ provider: 'p', model: 'm', maxTokens: -5 }],
      }),
    ).toThrow('llm-verifier: extraJudges[0].maxTokens must be a positive safe integer')

    // non-array extraJudges
    expect(() =>
      resolveConfig({
        extraJudges: 'invalid' as any,
      }),
    ).toThrow('llm-verifier: extraJudges must be an array')

    // non-object extraJudges element
    expect(() =>
      resolveConfig({
        extraJudges: [null as any],
      }),
    ).toThrow('llm-verifier: extraJudges[0] must be an object')
  })

  it('keeps P06 process selection off unless it was explicitly enabled and saved', () => {
    // Default off is a product decision, not an accident: a new install or an old config without
    // the field must never enter the request-level path.
    expect(resolveConfig({}).autoProcessSelection).toBe(false)
    expect(Config({}).autoProcessSelection).toBe(false)
    // A user-saved true survives resolution and re-serialization through the schema.
    expect(resolveConfig({ autoProcessSelection: true }).autoProcessSelection).toBe(true)
    const roundTripped = Config({ ...Config({}), autoProcessSelection: true } as never) as { autoProcessSelection?: boolean }
    expect(roundTripped.autoProcessSelection).toBe(true)
  })

  it('defaults the failure-evidence hand-off ON inside P06, and can be turned off', () => {
    // ON by default: without the evidence the extra candidate is written from exactly the same
    // information as the reply the session already showed failing, so the cycle mostly measures
    // sampling noise. OFF is the control arm of the controlled comparison, not an end state.
    expect(resolveConfig({}).autoProcessFailureContext).toBe(true)
    expect(Config({}).autoProcessFailureContext).toBe(true)
    expect(resolveConfig({ autoProcessFailureContext: false }).autoProcessFailureContext).toBe(false)
    const roundTripped = Config({ ...Config({}), autoProcessFailureContext: false } as never) as { autoProcessFailureContext?: boolean }
    expect(roundTripped.autoProcessFailureContext).toBe(false)
  })

  it('resolves the criteria preset and defaults to the historical coding rubric', () => {
    const resolved = resolveConfig({})
    // Default MUST stay 'coding': it is the only preset byte-identical to DEFAULT_CRITERIA, so an
    // existing installation's verdicts and cache keys do not move.
    expect(resolved.criteriaPreset).toBe('coding')
    expect(resolved.criteriaFile).toBe('')
    expect(resolveConfig({ criteriaPreset: 'research' }).criteriaPreset).toBe('research')
    expect(resolveConfig({ criteriaPreset: 'custom', criteriaFile: '  rubric.md ' }).criteriaFile).toBe('rubric.md')
    // A custom preset with no file is NOT a config error: the resolver degrades to coding and
    // reports why, so a typo in a rubric path cannot disable the gate.
    expect(resolveConfig({ criteriaPreset: 'custom' }).criteriaFile).toBe('')
    expect(() => resolveConfig({ criteriaPreset: 'nonsense' as any })).toThrow('llm-verifier: criteriaPreset must be one of coding, debug, research, ops, writing, custom')
  })

  it('regression: primary configuration still validates and behaves as before', () => {
    expect(() => resolveConfig({ provider: '' })).toThrow('llm-verifier: provider must be non-empty')
    expect(() => resolveConfig({ provider: '   ' })).toThrow('llm-verifier: provider must be non-empty')
    expect(() => resolveConfig({ model: '' })).toThrow('llm-verifier: model must be non-empty')
    expect(() => resolveConfig({ model: '   ' })).toThrow('llm-verifier: model must be non-empty')
    expect(() => resolveConfig({ maxTokens: 0 })).toThrow('llm-verifier: maxTokens must be a positive safe integer')
    expect(() => resolveConfig({ autoVerifyMode: 'invalid' as any })).toThrow('llm-verifier: autoVerifyMode must be manual, smart, or strict')
    expect(() => resolveConfig({ autoVerifyThreshold: 1.5 })).toThrow('llm-verifier: autoVerifyThreshold must be between 0 and 1')
    expect(() => resolveConfig({ maxRetries: -1 })).toThrow('llm-verifier: maxRetries must be a non-negative safe integer')

    const valid = resolveConfig({
      provider: 'openai',
      model: 'gpt-4.5-preview',
      reasoningEffort: 'medium',
      maxTokens: 4096,
    })
    expect(valid.provider).toBe('openai')
    expect(valid.model).toBe('gpt-4.5-preview')
    expect(valid.reasoningEffort).toBe('medium')
    expect(valid.maxTokens).toBe(4096)
    expect(valid.judges).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4.5-preview',
        reasoningEffort: 'medium',
        maxTokens: 4096,
        label: 'gpt-4.5-preview',
      },
    ])
  })

  it('Config schema accepts optional keys inside extraJudges array and defaults to []', () => {
    const fromEmpty = Config({})
    expect(fromEmpty.extraJudges).toEqual([])

    const fromPartial = Config({
      extraJudges: [{ provider: 'openai', model: 'gpt-4o' }],
    })
    expect(fromPartial.extraJudges).toEqual([{ provider: 'openai', model: 'gpt-4o' }])
    const resolved = resolveConfig(fromPartial)
    expect(resolved.judges).toHaveLength(2)
  })
})
describe('config - settings payload seam', () => {
  it('accepts the exact section the settings page writes (client-judges -> Config -> resolveConfig)', () => {
    const drafts: ExtraJudgeDraft[] = [
      { provider: ' openai ', model: ' gpt-4o ', label: 'Second opinion' },
      { provider: 'anthropic', model: 'claude-3-5-sonnet', reasoningEffort: '' },
      { provider: 'local', model: 'qwen3', label: '   ' },
    ]
    // RPC carries plain JSON, so the typed payload below is what actually crosses the seam.
    const payload = JSON.parse(JSON.stringify(serializeExtraJudges(drafts))) as NonNullable<Config['extraJudges']>
    expect(payload).toEqual([
      { provider: 'openai', model: 'gpt-4o', label: 'Second opinion' },
      { provider: 'anthropic', model: 'claude-3-5-sonnet' },
      { provider: 'local', model: 'qwen3' },
    ])

    // The settings namespace validates the section with the schema, then resolveConfig runs again.
    const parsed = Config({ provider: 'deepseek-official', model: 'deepseek-flash', extraJudges: payload })
    expect(parsed.extraJudges).toEqual(payload)
    const resolved = resolveConfig(parsed)
    expect(resolved.judges.map(judge => judge.label)).toEqual(['deepseek-flash', 'Second opinion', 'claude-3-5-sonnet', 'qwen3'])
    expect(resolved.judges.map(judge => judge.maxTokens)).toEqual([32768, 32768, 32768, 32768])
  })

  it('carries the criteria preset across the settings schema, JSON boundary and resolveConfig', () => {
    // The host validates the stored section with the schema and the RPC carries plain JSON, so the
    // new keys must survive Config -> JSON -> Config -> resolveConfig, not just resolveConfig.
    const payload = JSON.parse(JSON.stringify(Config({ provider: 'deepseek-official', model: 'deepseek-flash', criteriaPreset: 'ops', criteriaFile: ' criteria/ops.md ' })))
    expect(payload.criteriaPreset).toBe('ops')
    expect(payload.criteriaFile).toBe(' criteria/ops.md ')
    const resolved = resolveConfig(payload)
    expect(resolved.criteriaPreset).toBe('ops')
    // The schema preserves what the user typed; resolveConfig is what trims.
    expect(resolved.criteriaFile).toBe('criteria/ops.md')
    // Every selectable value round-trips, and unset stays on the historical default.
    for (const preset of ['coding', 'debug', 'research', 'ops', 'writing', 'custom'] as const) {
      expect(resolveConfig(Config({ criteriaPreset: preset })).criteriaPreset).toBe(preset)
    }
    expect(Config({}).criteriaPreset).toBe('coding')
    expect(resolveConfig({}).criteriaFile).toBe('')
  })

  it('rejects the section the settings page blocks: a duplicate of the primary judge', () => {
    const drafts: ExtraJudgeDraft[] = [{ provider: 'deepseek-official', model: 'deepseek-flash' }]
    const payload = JSON.parse(JSON.stringify(serializeExtraJudges(drafts))) as NonNullable<Config['extraJudges']>
    expect(() => resolveConfig(Config({ provider: 'deepseek-official', model: 'deepseek-flash', extraJudges: payload }))).toThrow(/duplicate judge/)
  })
})

describe('config - temperature', () => {
  it('defaults to 0.2 in schema and resolveConfig', () => {
    const fromSchema = Config({})
    expect(fromSchema.temperature).toBe(0.2)
    const resolved = resolveConfig({})
    expect(resolved.temperature).toBe(0.2)
  })

  it('accepts explicit valid temperature (including 0, 1.5, 2)', () => {
    const fromSchema = Config({ temperature: 0.7 })
    expect(fromSchema.temperature).toBe(0.7)
    const resolved = resolveConfig({ temperature: 0.7 })
    expect(resolved.temperature).toBe(0.7)

    expect(resolveConfig({ temperature: 0 }).temperature).toBe(0)
    expect(resolveConfig({ temperature: 2 }).temperature).toBe(2)
  })

  it('rejects temperature < 0, > 2, or NaN with expected message', () => {
    expect(() => resolveConfig({ temperature: -1 })).toThrow('llm-verifier: temperature must be between 0 and 2')
    expect(() => resolveConfig({ temperature: 3 })).toThrow('llm-verifier: temperature must be between 0 and 2')
    expect(() => resolveConfig({ temperature: NaN })).toThrow('llm-verifier: temperature must be between 0 and 2')
  })
})
describe('config - automatic verification repeats and budget', () => {
  it('scores routing once and the final acceptance twice by default', () => {
    const resolved = resolveConfig({})
    // Routing stays a cheap single round in the config; only compare is rounded up to an
    // even count at run time (it judges a single pair, so an odd count would leave the
    // A/B order uncorrected). select and track keep the configured round.
    expect(resolved.autoVerifyRepeats).toBe(1)
    expect(resolved.autoVerifyFinalRepeats).toBe(2)
  })

  it('accepts an explicit final repeat count', () => {
    expect(resolveConfig({ autoVerifyFinalRepeats: 4 }).autoVerifyFinalRepeats).toBe(4)
    expect(Config({ autoVerifyFinalRepeats: 3 }).autoVerifyFinalRepeats).toBe(3)
  })

  it('rejects a non-positive final repeat count', () => {
    expect(() => resolveConfig({ autoVerifyFinalRepeats: 0 })).toThrow(/autoVerifyFinalRepeats must be a positive safe integer/)
  })

  it('leaves headroom in the task model-call budget for the final acceptance', () => {
    // 54 calls for an eight-candidate tournament (one round; the engine orients each
    // pair instead of doubling the rounds) + 6 for the final acceptance per judge.
    expect(resolveConfig({}).autoMaxModelCallsPerTask).toBe(96)
    expect(resolveConfig({}).autoMaxModelCallsPerSession).toBe(240)
  })
})
