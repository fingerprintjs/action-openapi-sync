import { parseArgs } from 'node:util'
import { handlePrLifecycle } from './pr'

const { values: args } = parseArgs({
  options: {
    'source-repo': { type: 'string' },
    'source-pr': { type: 'string' },
    'source-pr-merged': { type: 'string', default: 'true' },
    'target-repo': { type: 'string' },
    'target-pr': { type: 'string' },
    'comment-on-source-pr': { type: 'string', default: 'true' },
  },
  strict: true,
})

const targetGithubToken = process.env.TARGET_REPO_GITHUB_TOKEN
const sourceGithubToken = process.env.SOURCE_REPO_GITHUB_TOKEN

if (!targetGithubToken || !args['source-repo'] || !args['source-pr'] || !args['target-repo'] || !args['target-pr']) {
  console.error(
    'Error: TARGET_REPO_GITHUB_TOKEN env var, --source-repo, --source-pr, --target-repo, and --target-pr are required'
  )
  process.exit(1)
}

handlePrLifecycle({
  sourceGithubToken,
  targetGithubToken,
  sourceRepo: args['source-repo'],
  sourcePrNumber: parseInt(args['source-pr'], 10),
  sourcePrMerged: args['source-pr-merged'] === 'true',
  targetRepo: args['target-repo'],
  targetPrNumber: parseInt(args['target-pr'], 10),
  commentOnSourcePr: args['comment-on-source-pr'] === 'true',
})
  .then(() => {
    console.log('PR lifecycle actions completed.')
  })
  .catch((error: unknown) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
