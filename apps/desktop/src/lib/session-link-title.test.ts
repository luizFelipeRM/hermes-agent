import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSession } from '@/hermes'
import { sessionTitle } from '@/lib/chat-runtime'
import { $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import {
  __resetSessionLinkTitleCache,
  fetchSessionLinkTitle,
  lookupLocalSessionTitle,
  parseSessionRefValue,
  sessionRefCacheKey,
  sessionRefFallbackLabel
} from './session-link-title'

vi.mock('@/hermes', () => ({
  getSession: vi.fn()
}))

function sessionRow(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '20260101_abc123',
    title: 'Research notes',
    preview: '',
    started_at: 0,
    message_count: 1,
    source: 'cli',
    profile: 'default',
    ...overrides
  }
}

afterEach(() => {
  __resetSessionLinkTitleCache()
  $sessions.set([])
  vi.mocked(getSession).mockReset()
})

describe('parseSessionRefValue', () => {
  it('splits profile and session id', () => {
    expect(parseSessionRefValue('work/20260101_abc123')).toEqual({
      profile: 'work',
      sessionId: '20260101_abc123'
    })
  })

  it('treats bare values as session ids', () => {
    expect(parseSessionRefValue('20260101_abc123')).toEqual({ sessionId: '20260101_abc123' })
  })
})

describe('sessionRefFallbackLabel', () => {
  it('truncates long ids', () => {
    expect(sessionRefFallbackLabel('default/20260610_120000_abcdef')).toBe('20260610…')
  })
})

describe('lookupLocalSessionTitle', () => {
  it('reads from the in-memory session list', () => {
    $sessions.set([sessionRow({ profile: 'work', title: 'Branch plan' })])

    expect(lookupLocalSessionTitle('work/20260101_abc123')).toBe('Branch plan')
  })

  it('matches lineage roots', () => {
    $sessions.set([
      sessionRow({
        id: '20260102_tip',
        _lineage_root_id: '20260101_abc123',
        title: 'Compressed chat'
      })
    ])

    expect(lookupLocalSessionTitle('20260101_abc123')).toBe('Compressed chat')
  })
})

describe('fetchSessionLinkTitle', () => {
  it('dedupes concurrent lookups', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionRow({ title: 'From API' }))

    const value = 'default/20260101_abc123'
    const [first, second] = await Promise.all([fetchSessionLinkTitle(value), fetchSessionLinkTitle(value)])

    expect(first).toBe('From API')
    expect(second).toBe('From API')
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(getSession).toHaveBeenCalledWith('20260101_abc123', 'default')
  })

  it('uses the local sidebar cache before calling the API', async () => {
    $sessions.set([sessionRow({ title: 'Cached title' })])

    const title = await fetchSessionLinkTitle('default/20260101_abc123')

    expect(title).toBe('Cached title')
    expect(getSession).not.toHaveBeenCalled()
  })

  it('keeps separate cache entries per profile', async () => {
    vi.mocked(getSession).mockImplementation(async (id, profile) =>
      sessionRow({
        id,
        profile: profile ?? 'default',
        title: profile === 'work' ? 'Work chat' : 'Home chat'
      })
    )

    const home = await fetchSessionLinkTitle('default/20260101_abc123')
    const work = await fetchSessionLinkTitle('work/20260101_abc123')

    expect(home).toBe('Home chat')
    expect(work).toBe('Work chat')
    expect(sessionRefCacheKey('default/20260101_abc123')).not.toBe(sessionRefCacheKey('work/20260101_abc123'))
  })

  it('falls back to preview text from the API row', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionRow({ title: '', preview: 'Summarize this repo' }))

    await expect(fetchSessionLinkTitle('20260101_abc123')).resolves.toBe(sessionTitle(sessionRow({ title: '', preview: 'Summarize this repo' })))
  })
})
