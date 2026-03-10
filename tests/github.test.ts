import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { setOutput, formatFileSection, generatePrBody } from '../src/github'
import type { DiffResult } from '../src/types'

describe('setOutput', () => {
  const originalGithubOutput = process.env.GITHUB_OUTPUT
  let tmpFile: string

  afterEach(() => {
    if (originalGithubOutput) {
      process.env.GITHUB_OUTPUT = originalGithubOutput
    } else {
      delete process.env.GITHUB_OUTPUT
    }
    if (tmpFile) {
      fs.unlinkSync(tmpFile)
    }
  })

  it('does nothing when GITHUB_OUTPUT is not set', () => {
    delete process.env.GITHUB_OUTPUT

    expect(() => setOutput('has_diff', 'true')).not.toThrow()
  })

  it('appends output variable to GITHUB_OUTPUT file', () => {
    tmpFile = path.join(os.tmpdir(), `github-output-${Date.now()}.txt`)
    fs.closeSync(fs.openSync(tmpFile, 'w'))
    process.env.GITHUB_OUTPUT = tmpFile

    setOutput('has_diff', 'true')

    const content = fs.readFileSync(tmpFile, 'utf-8')
    expect(content).toBe(`\
has_diff<<EOF_OPENAPI_SYNC
true
EOF_OPENAPI_SYNC
`)
  })

  it('appends multiple outputs to the same file', () => {
    tmpFile = path.join(os.tmpdir(), `github-output-${Date.now()}.txt`)
    fs.closeSync(fs.openSync(tmpFile, 'w'))
    process.env.GITHUB_OUTPUT = tmpFile

    setOutput('has_diff', 'true')
    setOutput('diff_summary', '1 modified')

    const content = fs.readFileSync(tmpFile, 'utf-8')
    expect(content).toContain(`\
has_diff<<EOF_OPENAPI_SYNC
true
EOF_OPENAPI_SYNC
`)
    expect(content).toContain(`\
diff_summary<<EOF_OPENAPI_SYNC
1 modified
EOF_OPENAPI_SYNC
`)
  })
})

describe('formatFileSection', () => {
  it('formats files as a collapsible markdown details block', () => {
    const result = formatFileSection('Modified files', ['a.yaml', 'b.yaml'])

    expect(result).toEqual([
      '',
      '<details>',
      '<summary>Modified files</summary>',
      '',
      '- `a.yaml`',
      '- `b.yaml`',
      '',
      '</details>',
    ])
  })
})

describe('generatePrBody', () => {
  it('includes all change sections when present', () => {
    const diff: DiffResult = {
      hasDiff: true,
      added: ['new.yaml'],
      modified: ['changed.yaml'],
      deleted: ['removed.yaml'],
      summary: '1 added, 1 modified, 1 deleted',
    }

    const body = generatePrBody(diff)

    expect(body).toContain('This PR automatically updates the OpenAPI schema.')
    expect(body).toContain('**1 added, 1 modified, 1 deleted**')
    expect(body).toContain('<summary>Added files</summary>')
    expect(body).toContain('`new.yaml`')
    expect(body).toContain('<summary>Modified files</summary>')
    expect(body).toContain('`changed.yaml`')
    expect(body).toContain('<summary>Deleted files</summary>')
    expect(body).toContain('`removed.yaml`')
    expect(body).toContain('**Note for reviewers**')
  })

  it('omits modified section when empty', () => {
    const diff: DiffResult = {
      hasDiff: true,
      added: ['new.yaml'],
      modified: [],
      deleted: [],
      summary: '1 added',
    }

    const body = generatePrBody(diff)

    expect(body).not.toContain('Modified files')
    expect(body).toContain('<summary>Added files</summary>')
  })

  it('omits empty sections', () => {
    const diff: DiffResult = {
      hasDiff: true,
      added: [],
      modified: ['changed.yaml'],
      deleted: [],
      summary: '1 modified',
    }

    const body = generatePrBody(diff)

    expect(body).toContain('<summary>Modified files</summary>')
    expect(body).not.toContain('Added files')
    expect(body).not.toContain('Deleted files')
  })
})
