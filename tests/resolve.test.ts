import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { describe, it, expect, vi } from 'vitest'
import { resolveRefs } from '../src/resolve'

const sourceRoot = path.resolve(__dirname, 'fixtures/source')
const resolveFixturesDir = path.resolve(__dirname, 'fixtures/resolve')

function readFixture(name: string): string {
  return fsSync.readFileSync(path.join(resolveFixturesDir, name), 'utf-8')
}

describe('resolveRefs', () => {
  it('resolves the full ref graph from entrypoint', async () => {
    const files = await resolveRefs('api/v2/petstore-api.yml', sourceRoot)

    // Entrypoint itself
    expect(files.has('api/v2/petstore-api.yml')).toBe(true)

    // $refs
    expect(files.has('api/v2/paths/pets.yml')).toBe(true)
    expect(files.has('api/v2/paths/pet.yml')).toBe(true)
    expect(files.has('api/v2/paths/internal-metrics.yml')).toBe(true)
    expect(files.has('api/v2/components/schemas/Pet.yml')).toBe(true)
    expect(files.has('api/v2/components/schemas/InternalDiagnostics.yml')).toBe(true)
    expect(files.has('api/v2/components/schemas/MixedModel.yml')).toBe(true)
  })

  it('resolves deeply nested refs (branching)', async () => {
    const files = await resolveRefs('api/v2/petstore-api.yml', sourceRoot)

    expect(files.has('api/v2/components/schemas/breeds/Breed.yml')).toBe(true)
    expect(files.has('api/v2/components/schemas/vaccinations/Vaccination.yml')).toBe(true)
    expect(files.has('api/v2/components/schemas/health/Microchip.yml')).toBe(true)

    expect(files.has('api/v2/components/schemas/breeds/BreedConfidence.yml')).toBe(true)

    expect(files.has('api/v2/components/schemas/health/Internal.yml')).toBe(true)
    expect(files.has('api/v2/components/schemas/health/EncryptedRecord.yml')).toBe(true)
  })

  it('includes non-YAML files referenced via $ref', async () => {
    const files = await resolveRefs('api/v2/petstore-api.yml', sourceRoot)

    expect(files.has('api/v2/paths/examples/pets/get_pet_200.json')).toBe(true)
  })

  it('handles circular references without infinite loop', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-circular-'))

    await fs.writeFile(path.join(tmpDir, 'a.yml'), readFixture('circular-a.yml'))
    await fs.writeFile(path.join(tmpDir, 'b.yml'), readFixture('circular-b.yml'))

    const files = await resolveRefs('a.yml', tmpDir)
    expect(files.has('a.yml')).toBe(true)
    expect(files.has('b.yml')).toBe(true)
    expect(files.size).toBe(2)

    await fs.rm(tmpDir, { recursive: true })
  })

  it('extracts file part from fragment refs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-fragment-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), readFixture('entry-fragment-ref.yml'))
    await fs.writeFile(path.join(tmpDir, 'models.yml'), readFixture('models.yml'))

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.has('entry.yml')).toBe(true)
    expect(files.has('models.yml')).toBe(true)

    await fs.rm(tmpDir, { recursive: true })
  })

  it('skips internal-only refs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-internal-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), readFixture('entry-internal-ref.yml'))

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.size).toBe(1)
    expect(files.has('entry.yml')).toBe(true)

    await fs.rm(tmpDir, { recursive: true })
  })

  it('warns on missing referenced file and continues', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-missing-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), readFixture('entry-missing-ref.yml'))
    await fs.writeFile(path.join(tmpDir, 'exists.yml'), 'type: string\n')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.has('entry.yml')).toBe(true)
    expect(files.has('exists.yml')).toBe(true)
    expect(files.has('missing.yml')).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing.yml'))

    warnSpy.mockRestore()
    await fs.rm(tmpDir, { recursive: true })
  })

  it('does not include unreachable files on disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-unreachable-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), 'type: string\n')
    await fs.writeFile(path.join(tmpDir, 'unreachable.yml'), 'type: number\n')

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.has('entry.yml')).toBe(true)
    expect(files.has('unreachable.yml')).toBe(false)

    await fs.rm(tmpDir, { recursive: true })
  })

  it('entrypoint is always included in the set', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-entry-'))
    await fs.writeFile(path.join(tmpDir, 'entry.yml'), 'type: string\n')

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.has('entry.yml')).toBe(true)

    await fs.rm(tmpDir, { recursive: true })
  })

  it('counts total reachable files correctly', async () => {
    const files = await resolveRefs('api/v2/petstore-api.yml', sourceRoot)

    expect(files.size).toBe(14)
  })

  it('warns and continues on invalid YAML', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-invalid-yml-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), readFixture('entry-bad-ref.yml'))
    await fs.writeFile(path.join(tmpDir, 'bad.yml'), 'invalid: yml: [unclosed')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.has('entry.yml')).toBe(true)
    expect(files.has('bad.yml')).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad.yml'))

    warnSpy.mockRestore()
    await fs.rm(tmpDir, { recursive: true })
  })

  it('does not parse non-YAML/JSON files for refs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-noparse-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), readFixture('entry-data-ref.yml'))
    await fs.writeFile(path.join(tmpDir, 'data.txt'), '$ref: "./should-not-follow.yml"')
    await fs.writeFile(path.join(tmpDir, 'should-not-follow.yml'), 'type: string\n')

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.has('entry.yml')).toBe(true)
    expect(files.has('data.txt')).toBe(true)
    expect(files.has('should-not-follow.yml')).toBe(false)

    await fs.rm(tmpDir, { recursive: true })
  })

  it('handles $ref with empty file part after split', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-empty-ref-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), readFixture('entry-hash-ref.yml'))

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.size).toBe(1)
    expect(files.has('entry.yml')).toBe(true)

    await fs.rm(tmpDir, { recursive: true })
  })

  it('skips $ref with empty string value', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-empty-string-'))

    await fs.writeFile(path.join(tmpDir, 'entry.yml'), readFixture('entry-empty-ref.yml'))

    const files = await resolveRefs('entry.yml', tmpDir)
    expect(files.size).toBe(1)
    expect(files.has('entry.yml')).toBe(true)

    await fs.rm(tmpDir, { recursive: true })
  })
})
