import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { computeDiff } from '../src/diff'

const fixturesDir = path.resolve(__dirname, 'fixtures/diff')

describe('computeDiff', () => {
  let targetRoot: string
  const apiYml = fs.readFileSync(path.join(fixturesDir, 'api.yml'), 'utf-8')
  const apiOldTitleYml = fs.readFileSync(path.join(fixturesDir, 'api-old-title.yml'), 'utf-8')
  const apiNewTitleYml = fs.readFileSync(path.join(fixturesDir, 'api-new-title.yml'), 'utf-8')

  beforeEach(() => {
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-test-'))
  })

  afterEach(() => {
    fs.rmSync(targetRoot, { recursive: true, force: true })
  })

  function writeTargetFile(relPath: string, content: string) {
    const absPath = path.join(targetRoot, relPath)
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content, 'utf-8')
  }

  it('reports no diff when content is identical', () => {
    writeTargetFile('schemas/api.yml', apiYml)

    const newFiles = new Map([['schemas/api.yml', apiYml]])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.hasDiff).toBe(false)
    expect(result.added).toEqual([])
    expect(result.modified).toEqual([])
    expect(result.deleted).toEqual([])
    expect(result.summary).toBe('No changes')
  })

  it('treats whitespace-only differences as no diff', () => {
    writeTargetFile('schemas/api.yml', 'openapi: 3.0.0  \ninfo:\n  title: API\n\n\n')

    const newFiles = new Map([
      [
        'schemas/api.yml',
        `\
openapi: 3.0.0
info:
  title: API`,
      ],
    ])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.hasDiff).toBe(false)
  })

  it('treats CRLF vs LF as no diff', () => {
    writeTargetFile(
      'schemas/api.yml',
      `\
openapi: 3.0.0\r
info:\r
  title: API\r
`
    )

    const newFiles = new Map([['schemas/api.yml', apiYml]])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.hasDiff).toBe(false)
  })

  it('detects modified files', () => {
    writeTargetFile('schemas/api.yml', apiOldTitleYml)

    const newFiles = new Map([['schemas/api.yml', apiNewTitleYml]])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.hasDiff).toBe(true)
    expect(result.modified).toEqual(['schemas/api.yml'])
    expect(result.added).toEqual([])
    expect(result.deleted).toEqual([])
    expect(result.summary).toBe('1 file(s) modified')
  })

  it('detects added files', () => {
    const newFiles = new Map([['schemas/new-file.yml', 'content: new\n']])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.hasDiff).toBe(true)
    expect(result.added).toEqual(['schemas/new-file.yml'])
    expect(result.modified).toEqual([])
    expect(result.deleted).toEqual([])
    expect(result.summary).toBe('1 file(s) added')
  })

  it('detects deleted files in managed directories', () => {
    writeTargetFile('schemas/components/OldSchema.yml', 'type: object\n')
    writeTargetFile('schemas/components/Kept.yml', 'type: string\n')

    const newFiles = new Map([['schemas/components/Kept.yml', 'type: string\n']])
    const result = computeDiff(newFiles, targetRoot, ['schemas/components'])

    expect(result.hasDiff).toBe(true)
    expect(result.deleted).toEqual(['schemas/components/OldSchema.yml'])
    expect(result.modified).toEqual([])
    expect(result.added).toEqual([])
  })

  it('does not delete files outside managed directories', () => {
    writeTargetFile('schemas/v1-api.yml', 'openapi: 3.0.0\n')
    writeTargetFile('schemas/components/Event.yml', 'type: object\n')

    // Only manage schemas/components, not schemas/ root
    const newFiles = new Map([['schemas/components/Event.yml', 'type: object\n']])
    const result = computeDiff(newFiles, targetRoot, ['schemas/components'])

    expect(result.hasDiff).toBe(false)
    expect(result.deleted).toEqual([])
  })

  it('handles mixed added, modified, and deleted files', () => {
    writeTargetFile('schemas/api.yml', 'old content\n')
    writeTargetFile('schemas/components/Old.yml', 'old model\n')

    const newFiles = new Map([
      ['schemas/api.yml', 'new content\n'],
      ['schemas/components/New.yml', 'new model\n'],
    ])
    const result = computeDiff(newFiles, targetRoot, ['schemas', 'schemas/components'])

    expect(result.hasDiff).toBe(true)
    expect(result.modified).toEqual(['schemas/api.yml'])
    expect(result.added).toEqual(['schemas/components/New.yml'])
    expect(result.deleted).toEqual(['schemas/components/Old.yml'])
    expect(result.summary).toBe('1 file(s) modified, 1 file(s) added, 1 file(s) deleted')
  })

  it('handles empty target directory', () => {
    const newFiles = new Map([['schemas/api.yml', 'openapi: 3.0.0\n']])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.hasDiff).toBe(true)
    expect(result.added).toEqual(['schemas/api.yml'])
  })

  it('handles empty new files map', () => {
    writeTargetFile('schemas/components/Event.yml', 'type: object\n')

    const newFiles = new Map<string, string>()
    const result = computeDiff(newFiles, targetRoot, ['schemas/components'])

    expect(result.hasDiff).toBe(true)
    expect(result.deleted).toEqual(['schemas/components/Event.yml'])
    expect(result.summary).toBe('1 file(s) deleted')
  })

  it('sorts results alphabetically', () => {
    const newFiles = new Map([
      ['schemas/z-file.yml', 'z\n'],
      ['schemas/a-file.yml', 'a\n'],
      ['schemas/m-file.yml', 'm\n'],
    ])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.added).toEqual(['schemas/a-file.yml', 'schemas/m-file.yml', 'schemas/z-file.yml'])
  })

  it('handles nested files in managed directories', () => {
    writeTargetFile('schemas/components/schemas/deep/Nested.yml', 'old\n')
    writeTargetFile('schemas/components/schemas/deep/Keep.yml', 'keep\n')

    const newFiles = new Map([['schemas/components/schemas/deep/Keep.yml', 'keep\n']])
    const result = computeDiff(newFiles, targetRoot, ['schemas/components'])

    expect(result.hasDiff).toBe(true)
    expect(result.deleted).toEqual(['schemas/components/schemas/deep/Nested.yml'])
  })

  it('deduplicates deleted files from overlapping managed dirs', () => {
    writeTargetFile('schemas/components/Old.yml', 'old\n')

    const newFiles = new Map<string, string>()
    const result = computeDiff(newFiles, targetRoot, ['schemas', 'schemas/components'])

    expect(result.deleted).toEqual(['schemas/components/Old.yml'])
    expect(result.deleted.length).toBe(1)
  })

  it('formats summary with multiple counts', () => {
    writeTargetFile('schemas/a.yml', 'old-a\n')
    writeTargetFile('schemas/b.yml', 'old-b\n')

    const newFiles = new Map([
      ['schemas/a.yml', 'new-a\n'],
      ['schemas/b.yml', 'new-b\n'],
      ['schemas/c.yml', 'new-c\n'],
    ])
    const result = computeDiff(newFiles, targetRoot, ['schemas'])

    expect(result.summary).toBe('2 file(s) modified, 1 file(s) added')
  })
})
