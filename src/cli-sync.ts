import { parseArgs } from 'node:util'
import { loadConfig, getManagedTargetDirs, getExclusionPatterns } from './config'
import { computeDiff } from './diff'
import { setOutput, generatePrBody } from './github'
import { syncMultiFile, syncBundled } from './sync'
import { writeFiles, deleteFiles } from './writer'

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    'source-root': { type: 'string', default: '.' },
    'target-root': { type: 'string', default: 'target' },
  },
  strict: true,
})

if (!args.config) {
  console.error('Error: --config is required')
  process.exit(1)
}

/** Run the sync pipeline: load config, build target files, compute diff, and apply changes. */
async function runSync(): Promise<void> {
  const configPath = args.config!
  const sourceRoot = args['source-root']!
  const targetRoot = args['target-root']!

  console.log(`Loading config from ${configPath}`)
  const config = loadConfig(configPath)
  console.log(`Mode: ${config.mode}, Entrypoint: ${config.entrypoint}`)

  const targetFiles =
    config.mode === 'multi_file' ? await syncMultiFile(config, sourceRoot) : syncBundled(config, sourceRoot)

  const managedDirs = getManagedTargetDirs(config)
  const excludeFromDeletion = getExclusionPatterns(config)
  console.log('Computing diff...')
  const diff = computeDiff(targetFiles, targetRoot, managedDirs, excludeFromDeletion)

  setOutput('has_diff', String(diff.hasDiff))
  setOutput('diff_summary', diff.summary)

  if (!diff.hasDiff) {
    console.log('No meaningful changes detected.')
    return
  }

  console.log(`Changes: ${diff.summary}`)

  writeFiles(targetFiles, targetRoot)
  deleteFiles(diff.deleted, targetRoot)
  console.log('Files written successfully.')

  const prBody = generatePrBody(diff)
  setOutput('pr_body', prBody)
}

runSync().catch((error: unknown) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
