import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFiles, deleteFiles } from '../src/writer'

describe('writeFiles', () => {
  let targetRoot: string

  beforeEach(() => {
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-test-'))
  })

  afterEach(() => {
    fs.rmSync(targetRoot, { recursive: true, force: true })
  })

  it('writes a file to the target directory', () => {
    const files = new Map([['schemas/api.yml', 'openapi: 3.0.0\n']])
    writeFiles(files, targetRoot)

    const written = fs.readFileSync(path.join(targetRoot, 'schemas/api.yml'), 'utf-8')
    expect(written).toBe('openapi: 3.0.0\n')
  })

  it('creates nested parent directories', () => {
    const files = new Map([['schemas/components/schemas/Event.yml', 'type: object\n']])
    writeFiles(files, targetRoot)

    const written = fs.readFileSync(path.join(targetRoot, 'schemas/components/schemas/Event.yml'), 'utf-8')
    expect(written).toBe('type: object\n')
  })

  it('overwrites existing files', () => {
    const dir = path.join(targetRoot, 'schemas')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'api.yml'), 'old content\n')

    const files = new Map([['schemas/api.yml', 'new content\n']])
    writeFiles(files, targetRoot)

    const written = fs.readFileSync(path.join(targetRoot, 'schemas/api.yml'), 'utf-8')
    expect(written).toBe('new content\n')
  })

  it('writes multiple files', () => {
    const files = new Map([
      ['schemas/a.yml', 'a\n'],
      ['schemas/b.yml', 'b\n'],
      ['schemas/nested/c.yml', 'c\n'],
    ])
    writeFiles(files, targetRoot)

    expect(fs.readFileSync(path.join(targetRoot, 'schemas/a.yml'), 'utf-8')).toBe('a\n')
    expect(fs.readFileSync(path.join(targetRoot, 'schemas/b.yml'), 'utf-8')).toBe('b\n')
    expect(fs.readFileSync(path.join(targetRoot, 'schemas/nested/c.yml'), 'utf-8')).toBe('c\n')
  })

  it('handles empty file map', () => {
    const files = new Map<string, string>()
    writeFiles(files, targetRoot)
    expect(fs.readdirSync(targetRoot)).toEqual([])
  })
})

describe('deleteFiles', () => {
  let targetRoot: string

  beforeEach(() => {
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-delete-test-'))
  })

  afterEach(() => {
    fs.rmSync(targetRoot, { recursive: true, force: true })
  })

  function writeFile(relPath: string, content: string) {
    const absPath = path.join(targetRoot, relPath)
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content, 'utf-8')
  }

  it('deletes specified files', () => {
    writeFile('schemas/components/Old.yml', 'old\n')
    writeFile('schemas/components/Keep.yml', 'keep\n')

    deleteFiles(['schemas/components/Old.yml'], targetRoot)

    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/Old.yml'))).toBe(false)
    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/Keep.yml'))).toBe(true)
  })

  it('cleans up empty directories after deletion', () => {
    writeFile('schemas/components/deep/nested/Only.yml', 'only\n')

    deleteFiles(['schemas/components/deep/nested/Only.yml'], targetRoot)

    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/deep/nested'))).toBe(false)
    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/deep'))).toBe(false)
    expect(fs.existsSync(path.join(targetRoot, 'schemas/components'))).toBe(false)
    expect(fs.existsSync(path.join(targetRoot, 'schemas'))).toBe(false)
  })

  it('does not delete non-empty parent directories', () => {
    writeFile('schemas/components/Delete.yml', 'delete\n')
    writeFile('schemas/components/Keep.yml', 'keep\n')

    deleteFiles(['schemas/components/Delete.yml'], targetRoot)

    expect(fs.existsSync(path.join(targetRoot, 'schemas/components'))).toBe(true)
    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/Keep.yml'))).toBe(true)
  })

  it('handles already-deleted files gracefully', () => {
    // Should not throw for non-existent files
    deleteFiles(['schemas/nonexistent.yml'], targetRoot)
  })

  it('handles empty delete list', () => {
    writeFile('schemas/keep.yml', 'keep\n')

    deleteFiles([], targetRoot)

    expect(fs.existsSync(path.join(targetRoot, 'schemas/keep.yml'))).toBe(true)
  })

  it('deletes multiple files and cleans up mixed directories', () => {
    writeFile('schemas/components/a/File1.yml', 'f1\n')
    writeFile('schemas/components/a/File2.yml', 'f2\n')
    writeFile('schemas/components/b/File3.yml', 'f3\n')

    deleteFiles(['schemas/components/a/File1.yml', 'schemas/components/a/File2.yml'], targetRoot)

    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/a'))).toBe(false)
    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/b/File3.yml'))).toBe(true)
  })
})
