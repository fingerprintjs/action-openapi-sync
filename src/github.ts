import * as fs from 'node:fs'
import type { DiffResult } from './types'

/** Write a GH Actions output variable. */
export function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    const delimiter = 'EOF_OPENAPI_SYNC'
    fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
  }
}

/** Format a collapsible file list. */
export function formatFileSection(title: string, files: string[]): string[] {
  return ['', '<details>', `<summary>${title}</summary>`, '', ...files.map((f) => `- \`${f}\``), '', '</details>']
}

/** Generate the markdown PR body message. */
export function generatePrBody(diff: DiffResult): string {
  const lines: string[] = [
    'This PR automatically updates the OpenAPI schema.',
    '',
    '### Changes',
    '',
    `**${diff.summary}**`,
  ]

  if (diff.modified.length > 0) {
    lines.push(...formatFileSection('Modified files', diff.modified))
  }

  if (diff.added.length > 0) {
    lines.push(...formatFileSection('Added files', diff.added))
  }

  if (diff.deleted.length > 0) {
    lines.push(...formatFileSection('Deleted files', diff.deleted))
  }

  lines.push(
    '',
    '---',
    '',
    '**Note for reviewers**: Please review the schema changes.',
    'You _likely_ need to manually add a changeset file to this branch before merging.'
  )

  return lines.join('\n')
}
