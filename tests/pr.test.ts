import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handlePrLifecycle } from '../src/pr'
import type { PrOptions } from '../src/pr'

interface MockResponse {
  status: number
  body?: unknown
}

function mockFetch(responses: MockResponse[]): void {
  let callIndex = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const resp = responses[callIndex] ?? { status: 200, body: [] }
      callIndex++
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: async () => resp.body ?? [],
      }
    })
  )
}

/** Mock the 5-step fetch flow with sensible defaults. Override only the steps you care about. */
function mockFetchFlow(
  overrides?: Partial<{
    getSourceComments: MockResponse
    writeSourceComment: MockResponse
    manageLabel: MockResponse
    getTargetComments: MockResponse
    writeTargetComment: MockResponse
  }>
): void {
  mockFetch([
    overrides?.getSourceComments ?? { status: 200, body: [] },
    overrides?.writeSourceComment ?? { status: 201 },
    overrides?.manageLabel ?? { status: 404 },
    overrides?.getTargetComments ?? { status: 200, body: [] },
    overrides?.writeTargetComment ?? { status: 201 },
  ])
}

function defaultOptions(overrides?: Partial<PrOptions>): PrOptions {
  return {
    githubToken: 'test-token',
    sourceRepo: 'owner/source',
    sourcePrNumber: 42,
    sourcePrMerged: true,
    targetRepo: 'owner/target',
    targetPrNumber: 99,
    ...overrides,
  }
}

function getFetchCallBody(callIndex: number): Record<string, unknown> {
  const fetchMock = vi.mocked(fetch)
  return JSON.parse(String(fetchMock.mock.calls[callIndex][1]?.body))
}

function getFetchCallHeaders(callIndex: number): Record<string, string> {
  const fetchMock = vi.mocked(fetch)
  const headers = fetchMock.mock.calls[callIndex][1]?.headers
  return headers ? Object.fromEntries(Object.entries(headers)) : {}
}

describe('handlePrLifecycle', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates link comment on source PR when no existing comment', async () => {
    mockFetchFlow()

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[0][0]).toContain('/repos/owner/source/issues/42/comments')
    expect(fetchMock.mock.calls[1][0]).toContain('/repos/owner/source/issues/42/comments')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
    const body = getFetchCallBody(1)
    expect(body.body).toContain('<!-- openapi-sync-link -->')
    expect(body.body).toContain('owner/target#99')
  })

  it('updates existing link comment on source PR', async () => {
    mockFetchFlow({
      getSourceComments: { status: 200, body: [{ id: 777, body: '<!-- openapi-sync-link -->\nOld link' }] },
      writeSourceComment: { status: 200 },
    })

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[1][0]).toContain('/issues/comments/777')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PATCH')
  })

  it('adds warning label and comment when source not merged', async () => {
    mockFetchFlow({ manageLabel: { status: 200 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: false }))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[2][0]).toContain('/repos/owner/target/issues/99/labels')
    expect(fetchMock.mock.calls[2][1]?.method).toBe('POST')
    const labelBody = getFetchCallBody(2)
    expect(labelBody.labels).toEqual(['Not Completed'])

    const commentBody = getFetchCallBody(4)
    expect(commentBody.body).toContain('<!-- openapi-sync-status -->')
    expect(commentBody.body).toContain('not finalized yet')
  })

  it('removes warning label and adds merged comment when source is merged', async () => {
    mockFetchFlow({ manageLabel: { status: 200 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: true }))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[2][0]).toContain('/repos/owner/target/issues/99/labels/Not%20Completed')
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE')

    const commentBody = getFetchCallBody(4)
    expect(commentBody.body).toContain('<!-- openapi-sync-status -->')
    expect(commentBody.body).toContain('have been finalized')
    expect(commentBody.body).toContain('ready for review')
  })

  it('warns on failed comment listing', async () => {
    mockFetchFlow({ getSourceComments: { status: 403 } })

    await handlePrLifecycle(defaultOptions())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to list comments'))
  })

  it('warns on failed comment creation', async () => {
    mockFetchFlow({
      writeSourceComment: { status: 500 },
      writeTargetComment: { status: 500 },
    })

    await handlePrLifecycle(defaultOptions())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create comment'))
  })

  it('warns on failed comment update', async () => {
    mockFetchFlow({
      getSourceComments: { status: 200, body: [{ id: 1, body: '<!-- openapi-sync-link -->\nold' }] },
      writeSourceComment: { status: 500 },
    })

    await handlePrLifecycle(defaultOptions())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to update comment'))
  })

  it('warns on failed label add', async () => {
    mockFetchFlow({ manageLabel: { status: 403 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: false }))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to add label'))
  })

  it('warns on failed label removal', async () => {
    mockFetchFlow({ manageLabel: { status: 500 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: true }))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to remove label'))
  })

  it('does not warn when label removal returns 404 (label was not there)', async () => {
    mockFetchFlow()

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: true }))

    // No warning about label removal
    const labelWarnings = warnSpy.mock.calls.filter(
      // @ts-ignore
      (call) => typeof call[0] === 'string' && call[0].includes('Failed to remove label')
    )
    expect(labelWarnings).toHaveLength(0)
  })

  it('updates existing status comment instead of creating duplicate', async () => {
    mockFetchFlow({
      manageLabel: { status: 200 },
      getTargetComments: { status: 200, body: [{ id: 888, body: '<!-- openapi-sync-status -->\nOld status' }] },
      writeTargetComment: { status: 200 },
    })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: false }))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[4][0]).toContain('/issues/comments/888')
    expect(fetchMock.mock.calls[4][1]?.method).toBe('PATCH')
  })

  it('handles non-array response from comments endpoint', async () => {
    mockFetchFlow({
      getSourceComments: { status: 200, body: { message: 'unexpected' } },
      getTargetComments: { status: 200, body: 'not-an-array' },
    })

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[4][1]?.method).toBe('POST')
  })

  it('sends correct Authorization header', async () => {
    mockFetchFlow()

    await handlePrLifecycle(defaultOptions({ githubToken: 'my-secret-token' }))

    const fetchMock = vi.mocked(fetch)
    for (let i = 0; i < fetchMock.mock.calls.length; i++) {
      const headers = getFetchCallHeaders(i)
      expect(headers.Authorization).toBe('token my-secret-token')
    }
  })
})
