import { build } from 'esbuild'

await build({
  entryPoints: ['src/cli-sync.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  format: 'cjs',
})
