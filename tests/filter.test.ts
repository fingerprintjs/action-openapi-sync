import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'
import { filterFile, filterFiles, isFileExcluded, removeOrphanedFiles } from '../src/filter'
import type { InternalConfig } from '../src/types'

const fixturesDir = path.resolve(__dirname, 'fixtures/filter')
const internalObjectWithPropsContent = fs.readFileSync(
  path.join(fixturesDir, 'internal-object-with-props.yml'),
  'utf-8'
)
const internalObjectContent = fs.readFileSync(path.join(fixturesDir, 'internal-object.yml'), 'utf-8')
const internalStringContent = fs.readFileSync(path.join(fixturesDir, 'internal-string.yml'), 'utf-8')

const defaultConfig: InternalConfig = {
  internal_marker: 'x-internal',
  strip_fields: ['x-internal'],
  exclude_patterns: [],
}

function parseOutput(content: string | null): unknown {
  if (content === null) {
    return null
  }
  return yaml.load(content)
}

describe('isFileExcluded', () => {
  it('matches glob pattern', () => {
    const config: InternalConfig = { ...defaultConfig, exclude_patterns: ['**/internal/**'] }
    expect(isFileExcluded('api/v2/internal/debug.yml', config)).toBe(true)
  })

  it('does not match when no patterns match', () => {
    const config: InternalConfig = { ...defaultConfig, exclude_patterns: ['**/internal/**'] }
    expect(isFileExcluded('api/v2/paths/events.yml', config)).toBe(false)
  })

  it('returns false when no patterns configured', () => {
    expect(isFileExcluded('anything.yml', defaultConfig)).toBe(false)
  })
})

describe('filterFile', () => {
  it('returns null for file with top-level x-internal: true', () => {
    const result = filterFile(internalObjectWithPropsContent, defaultConfig)
    expect(result).toBeNull()
  })

  it('removes x-internal parameters from array', () => {
    const content = yaml.dump({
      parameters: [
        { name: 'limit', in: 'query' },
        { name: 'debug_token', in: 'query', 'x-internal': true },
        { name: 'offset', in: 'query' },
      ],
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      parameters: [
        { name: 'limit', in: 'query' },
        { name: 'offset', in: 'query' },
      ],
    })
  })

  it('removes x-internal schema properties', () => {
    const content = yaml.dump({
      type: 'object',
      properties: {
        id: { type: 'string' },
        internal_debug: { type: 'object', 'x-internal': true },
        name: { type: 'string' },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    })
  })

  it('removes x-internal path operations', () => {
    const content = yaml.dump({
      paths: {
        '/events': {
          get: { summary: 'Get events' },
          post: { summary: 'Create event', 'x-internal': true },
        },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      paths: {
        '/events': {
          get: { summary: 'Get events' },
        },
      },
    })
  })

  it('removes entire path when all operations are internal', () => {
    const content = yaml.dump({
      paths: {
        '/events': {
          get: { summary: 'Get events' },
        },
        '/debug': {
          get: { summary: 'Debug', 'x-internal': true },
          post: { summary: 'Debug post', 'x-internal': true },
        },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      paths: {
        '/events': {
          get: { summary: 'Get events' },
        },
      },
    })
  })

  it('strips all strip_fields keys from output', () => {
    const content = yaml.dump({
      type: 'object',
      'x-internal': false,
      properties: {
        id: { type: 'string', 'x-internal': false },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    })
  })

  it('prunes empty objects after stripping', () => {
    const content = yaml.dump({
      type: 'object',
      properties: {
        only_internal: { type: 'string', 'x-internal': true },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({ type: 'object' })
  })

  it('passes through file with no internal markers', () => {
    const input = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    }
    const content = yaml.dump(input)
    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual(input)
  })

  it('handles deeply nested x-internal in schema properties', () => {
    const content = yaml.dump({
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            public_field: { type: 'string' },
            nested_internal: {
              type: 'object',
              'x-internal': true,
              properties: { deep: { type: 'string' } },
            },
          },
        },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            public_field: { type: 'string' },
          },
        },
      },
    })
  })

  it('preserves non-YAML content as-is', () => {
    const content = 'this is not valid YAML: [invalid'
    const result = filterFile(content, defaultConfig)
    expect(result).toBe(content)
  })

  it('handles path item with x-internal at path level', () => {
    const content = yaml.dump({
      paths: {
        '/public': {
          get: { summary: 'Public' },
        },
        '/internal': {
          'x-internal': true,
          get: { summary: 'Internal' },
        },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      paths: {
        '/public': {
          get: { summary: 'Public' },
        },
      },
    })
  })

  it('preserves path-level non-operation keys', () => {
    const content = yaml.dump({
      paths: {
        '/events': {
          summary: 'Events endpoint',
          get: { summary: 'Get events' },
          post: { summary: 'Create', 'x-internal': true },
        },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      paths: {
        '/events': {
          summary: 'Events endpoint',
          get: { summary: 'Get events' },
        },
      },
    })
  })
})

describe('filterFiles', () => {
  it('processes multiple files and separates excluded from filtered', () => {
    const files = new Map([
      ['a.yml', `type: string\n`],
      ['b.yml', internalObjectContent],
      ['c.yml', `type: number\n`],
    ])
    const reachable = new Set(['a.yml', 'b.yml', 'c.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    expect(result.filtered.size).toBe(2)
    expect(result.filtered.has('a.yml')).toBe(true)
    expect(result.filtered.has('c.yml')).toBe(true)
    expect(result.excludedFiles.has('b.yml')).toBe(true)
  })

  it('excludes files matching exclude_patterns', () => {
    const config: InternalConfig = {
      ...defaultConfig,
      exclude_patterns: ['**/internal/**'],
    }
    const files = new Map([
      ['api/public.yml', `type: string\n`],
      ['api/internal/debug.yml', `type: string\n`],
    ])
    const reachable = new Set(['api/public.yml', 'api/internal/debug.yml'])

    const result = filterFiles(files, reachable, config)

    expect(result.filtered.has('api/public.yml')).toBe(true)
    expect(result.excludedFiles.has('api/internal/debug.yml')).toBe(true)
  })

  it('detects and removes dangling $ref to excluded files', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          type: 'object',
          properties: {
            public: { type: 'string' },
            internal: { $ref: './internal.yml' },
          },
        }),
      ],
      ['internal.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'internal.yml'])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = filterFiles(files, reachable, defaultConfig)

    expect(result.excludedFiles.has('internal.yml')).toBe(true)
    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({
      type: 'object',
      properties: {
        public: { type: 'string' },
      },
    })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dangling'))
    warnSpy.mockRestore()
  })

  it('generates warnings for dangling refs', () => {
    const files = new Map([
      [
        'entry.yml',
        yaml.dump({
          components: {
            schemas: {
              Ref: { $ref: './excluded.yml' },
            },
          },
        }),
      ],
      ['excluded.yml', internalStringContent],
    ])
    const reachable = new Set(['entry.yml', 'excluded.yml'])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    filterFiles(files, reachable, defaultConfig)

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('excluded.yml'))
    warnSpy.mockRestore()
  })

  it('ignores files not in reachableFiles set', () => {
    const files = new Map([
      ['reachable.yml', `type: string\n`],
      ['not-reachable.yml', `type: number\n`],
    ])
    const reachable = new Set(['reachable.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    expect(result.filtered.size).toBe(1)
    expect(result.filtered.has('reachable.yml')).toBe(true)
    expect(result.filtered.has('not-reachable.yml')).toBe(false)
  })

  it('handles cascading: removing dangling ref empties container', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          type: 'object',
          properties: {
            onlyRef: { $ref: './excluded.yml' },
          },
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({ type: 'object' })
  })

  it('cleans dangling refs in arrays', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          allOf: [{ $ref: './public.yml' }, { $ref: './excluded.yml' }],
        }),
      ],
      ['public.yml', `type: string\n`],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'public.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({
      allOf: [{ $ref: './public.yml' }],
    })
  })

  it('removes file entirely when all content becomes dangling', () => {
    const files = new Map([
      [
        'wrapper.yml',
        yaml.dump({
          $ref: './excluded.yml',
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['wrapper.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    expect(result.filtered.has('wrapper.yml')).toBe(false)
    expect(result.excludedFiles.has('wrapper.yml')).toBe(true)
  })

  it('handles non-record and non-array nodes in dangling ref cleanup', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          type: 'object',
          description: 'A plain string value',
          count: 42,
          properties: {
            name: { type: 'string' },
          },
        }),
      ],
    ])
    const reachable = new Set(['main.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({
      type: 'object',
      description: 'A plain string value',
      count: 42,
      properties: {
        name: { type: 'string' },
      },
    })
  })

  it('handles non-parseable YAML in second pass gracefully', () => {
    const files = new Map([
      ['good.yml', `type: string\n`],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['good.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    expect(result.filtered.has('good.yml')).toBe(true)
    expect(result.excludedFiles.has('excluded.yml')).toBe(true)
  })

  it('returns null when entire file becomes empty after filtering', () => {
    const content = yaml.dump({
      properties: {
        a: { type: 'string', 'x-internal': true },
        b: { type: 'number', 'x-internal': true },
      },
    })

    const result = filterFile(content, defaultConfig)
    expect(result).toBeNull()
  })

  it('handles file with no internal_marker set', () => {
    const config: InternalConfig = {
      internal_marker: '',
      strip_fields: [],
      exclude_patterns: [],
    }
    const content = yaml.dump({
      'x-internal': true,
      type: 'object',
    })

    const result = filterFile(content, config)
    expect(result).not.toBeNull()
  })

  it('passes through non-object YAML', () => {
    const result = filterFile('just a string', defaultConfig)
    expect(result).toBe('just a string')
  })

  it('removes all paths when all are internal', () => {
    const content = yaml.dump({
      info: { title: 'API' },
      paths: {
        '/a': {
          get: { summary: 'A', 'x-internal': true },
        },
        '/b': {
          post: { summary: 'B', 'x-internal': true },
        },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({ info: { title: 'API' } })
  })

  it('handles all parameters being internal', () => {
    const content = yaml.dump({
      parameters: [
        { name: 'a', in: 'query', 'x-internal': true },
        { name: 'b', in: 'query', 'x-internal': true },
      ],
    })

    const result = filterFile(content, defaultConfig)

    expect(result).toBeNull()
  })

  it('handles dangling ref cleanup removing all properties', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          type: 'object',
          properties: {
            a: { $ref: './excluded.yml' },
            b: { $ref: './excluded.yml' },
          },
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({ type: 'object' })
  })

  it('handles dangling ref in non-properties context', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          type: 'object',
          schema: { $ref: './excluded.yml' },
          name: 'test',
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({ type: 'object', name: 'test' })
  })

  it('handles second pass when YAML parse fails', () => {
    const files = new Map([['a.yml', `type: string\n`]])
    const reachable = new Set(['a.yml'])

    const result = filterFiles(files, reachable, defaultConfig)
    expect(result.filtered.has('a.yml')).toBe(true)
  })

  it('handles second pass when parsed YAML is not a record', () => {
    const files = new Map([['scalar.yml', `"a string"\n`]])
    const reachable = new Set(['scalar.yml'])

    const result = filterFiles(files, reachable, defaultConfig)
    expect(result.filtered.has('scalar.yml')).toBe(true)
  })

  it('excludes file when second pass strip+prune empties it', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          'x-internal': false,
          properties: {
            ref: { $ref: './excluded.yml' },
          },
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    expect(result.filtered.has('main.yml')).toBe(false)
    expect(result.excludedFiles.has('main.yml')).toBe(true)
  })

  it('preserves security key with empty scope list', () => {
    const content = yaml.dump({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    })
  })

  it('preserves empty arrays but prunes arrays that become empty later', () => {
    const content = yaml.dump({
      type: 'object',
      tags: [],
      someList: [{ properties: { a: { 'x-internal': true, type: 'string' } } }],
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({ type: 'object', tags: [] })
  })

  it('handles non-record path values', () => {
    const content = yaml.dump({
      paths: {
        '/events': 'a string instead of an object',
      },
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)

    expect(doc).toEqual({
      paths: {
        '/events': 'a string instead of an object',
      },
    })
  })

  it('marks changed when property in dangling ref cleanup has nested changes', () => {
    const files = new Map([
      [
        'dir/main.yml',
        yaml.dump({
          type: 'object',
          properties: {
            kept: { type: 'string' },
            nested: {
              type: 'object',
              properties: {
                a: { $ref: '../excluded.yml' },
                b: { type: 'number' },
              },
            },
          },
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['dir/main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('dir/main.yml') ?? '')
    expect(mainDoc).toEqual({
      type: 'object',
      properties: {
        kept: { type: 'string' },
        nested: {
          type: 'object',
          properties: {
            b: { type: 'number' },
          },
        },
      },
    })
  })

  it('preserves intentionally empty array after dangling ref cleanup', () => {
    const files = new Map([
      [
        'entry.yml',
        yaml.dump({
          openapi: '3.1.0',
          info: { title: 'API', version: '1.0' },
          security: [{ bearerAuth: [] }],
          paths: {
            '/public': { $ref: './public.yml' },
            '/internal': { $ref: './excluded.yml' },
          },
          components: {
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer' },
            },
          },
        }),
      ],
      ['public.yml', yaml.dump({ get: { summary: 'Public endpoint' } })],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['entry.yml', 'public.yml', 'excluded.yml'])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = filterFiles(files, reachable, defaultConfig)
    warnSpy.mockRestore()

    const entryDoc = parseOutput(result.filtered.get('entry.yml') ?? '')
    expect(entryDoc).toEqual({
      openapi: '3.1.0',
      info: { title: 'API', version: '1.0' },
      security: [{ bearerAuth: [] }],
      paths: {
        '/public': { $ref: './public.yml' },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    })
  })

  it('prunes empty arrays after all items have dangling refs', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          type: 'object',
          allOf: [{ $ref: './excluded.yml' }],
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({ type: 'object' })
  })

  it('prunes arrays that become empty after filtering internal items', () => {
    const content = yaml.dump({
      parameters: [{ name: 'a', in: 'query', 'x-internal': true }],
      type: 'object',
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)
    expect(doc).toEqual({ type: 'object' })
  })

  it('prunes array where all items become empty objects via pruneEmpty', () => {
    const content = yaml.dump({
      type: 'object',
      someList: [{ properties: { a: { 'x-internal': true, type: 'string' } } }],
    })

    const result = filterFile(content, defaultConfig)
    const doc = parseOutput(result)
    expect(doc).toEqual({ type: 'object' })
  })

  it('marks array changed when items have nested dangling ref changes but no items removed', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          allOf: [
            {
              type: 'object',
              properties: {
                keep: { type: 'string' },
                remove: { $ref: './excluded.yml' },
              },
            },
          ],
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            keep: { type: 'string' },
          },
        },
      ],
    })
  })

  it('preserves internal $ref (starting with #) during dangling ref cleanup', () => {
    const files = new Map([
      [
        'main.yml',
        yaml.dump({
          type: 'object',
          properties: {
            foo: { $ref: '#/definitions/Foo' },
          },
        }),
      ],
      ['excluded.yml', internalObjectContent],
    ])
    const reachable = new Set(['main.yml', 'excluded.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    const mainDoc = parseOutput(result.filtered.get('main.yml') ?? '')
    expect(mainDoc).toEqual({
      type: 'object',
      properties: {
        foo: { $ref: '#/definitions/Foo' },
      },
    })
  })

  it('skips files not in the source map', () => {
    const files = new Map([['a.yml', `type: string\n`]])
    const reachable = new Set(['a.yml', 'missing-from-map.yml'])

    const result = filterFiles(files, reachable, defaultConfig)

    expect(result.filtered.size).toBe(1)
    expect(result.filtered.has('a.yml')).toBe(true)
  })
})

describe('removeOrphanedFiles', () => {
  it('removes files not reachable from the entrypoint', () => {
    const filtered = new Map([
      ['entry.yml', yaml.dump({ type: 'object', schema: { $ref: './kept.yml' } })],
      ['kept.yml', yaml.dump({ type: 'string' })],
      ['orphan.yml', yaml.dump({ type: 'number' })],
    ])

    const orphaned = removeOrphanedFiles(filtered, 'entry.yml')

    expect(filtered.has('entry.yml')).toBe(true)
    expect(filtered.has('kept.yml')).toBe(true)
    expect(filtered.has('orphan.yml')).toBe(false)
    expect(orphaned).toEqual(['orphan.yml'])
  })

  it('follows transitive refs', () => {
    const filtered = new Map([
      ['entry.yml', yaml.dump({ $ref: './a.yml' })],
      ['a.yml', yaml.dump({ $ref: './b.yml' })],
      ['b.yml', yaml.dump({ type: 'string' })],
      ['orphan.yml', yaml.dump({ type: 'number' })],
    ])

    removeOrphanedFiles(filtered, 'entry.yml')

    expect(filtered.size).toBe(3)
    expect(filtered.has('orphan.yml')).toBe(false)
  })

  it('returns empty array when all files are reachable', () => {
    const filtered = new Map([
      ['entry.yml', yaml.dump({ $ref: './other.yml' })],
      ['other.yml', yaml.dump({ type: 'string' })],
    ])

    const orphaned = removeOrphanedFiles(filtered, 'entry.yml')

    expect(orphaned).toEqual([])
    expect(filtered.size).toBe(2)
  })

  it('skips refs pointing to files not in the map', () => {
    const filtered = new Map([['entry.yml', yaml.dump({ $ref: './missing.yml' })]])

    const orphaned = removeOrphanedFiles(filtered, 'entry.yml')

    expect(orphaned).toEqual([])
    expect(filtered.size).toBe(1)
  })

  it('handles circular refs without infinite loop', () => {
    const filtered = new Map([
      ['entry.yml', yaml.dump({ $ref: './a.yml' })],
      ['a.yml', yaml.dump({ $ref: './entry.yml' })],
    ])

    const orphaned = removeOrphanedFiles(filtered, 'entry.yml')

    expect(orphaned).toEqual([])
    expect(filtered.size).toBe(2)
  })

  it('ignores internal refs', () => {
    const filtered = new Map([
      ['entry.yml', yaml.dump({ $ref: '#/definitions/Foo' })],
      ['unlinked.yml', yaml.dump({ type: 'string' })],
    ])

    removeOrphanedFiles(filtered, 'entry.yml')

    expect(filtered.has('entry.yml')).toBe(true)
    expect(filtered.has('unlinked.yml')).toBe(false)
  })

  it('follows externalValue references', () => {
    const filtered = new Map([
      ['entry.yml', yaml.dump({ allOf: [{ $ref: './a.yml' }, { externalValue: 'data.json' }] })],
      ['a.yml', yaml.dump({ externalValue: 'data.json' })],
      ['data.json', '{"id": 1}'],
    ])

    const orphaned = removeOrphanedFiles(filtered, 'entry.yml')

    expect(orphaned).toEqual([])
    expect(filtered.size).toBe(3)
  })

  it('handles refs in nested directories', () => {
    const filtered = new Map([
      ['api/entry.yml', yaml.dump({ $ref: '../components/schema.yml' })],
      ['components/schema.yml', yaml.dump({ type: 'object' })],
      ['components/orphan.yml', yaml.dump({ type: 'string' })],
    ])

    removeOrphanedFiles(filtered, 'api/entry.yml')

    expect(filtered.has('components/schema.yml')).toBe(true)
    expect(filtered.has('components/orphan.yml')).toBe(false)
  })
})
