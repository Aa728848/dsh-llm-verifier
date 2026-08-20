import type { UserConfig } from 'tsdown'

const packageId = 'dsh-llm-verifier'
const fs = await import('node:fs')
const path = await import('node:path')
const localClientOut = process.env.DSH_LLM_VERIFIER_CLIENT_OUT
const clientOutputOptions = {
  entryFileNames: 'client.js',
  banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
  footer: 'return module.exports; } });',
  intro: 'var module = { exports: {} }; var exports = module.exports;',
}
const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-remotes/client',
]

const host: UserConfig = {
  name: packageId,
  entry: ['src/index.ts', 'src/core.ts', 'src/caller.ts'],
  outDir: 'lib',
  format: ['esm'],
  fixedExtension: false,
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [
      /^@deepseek-ai\//,
      'schemastery',
    ],
  },
}

const client: UserConfig = {
  name: `${packageId}/client`,
  entry: { client: 'src/client.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: clientExternals,
    alwaysBundle: (id: string) => clientExternals.includes(id) ? undefined : true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: clientOutputOptions,
}

const configs: UserConfig[] = [host, client]
if (localClientOut) {
  const resolved = path.resolve(localClientOut)
  fs.mkdirSync(resolved, { recursive: true })
  configs.push({ ...client, name: `${packageId}/client-live`, outDir: resolved, outputOptions: clientOutputOptions })
}

export default configs
