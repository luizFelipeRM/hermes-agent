import { useEffect, useMemo, useState } from 'react'

import { sessionTitle as formatSessionTitle } from '@/lib/chat-runtime'
import { getSession } from '@/hermes'
import { $sessions, sessionMatchesStoredId } from '@/store/session'

const titleCache = new Map<string, string>()
const titleInflight = new Map<string, Promise<string>>()
const titleSubs = new Map<string, Set<(value: string) => void>>()

export function parseSessionRefValue(value: string): { profile?: string; sessionId: string } {
  const trimmed = value.trim()

  if (!trimmed) {
    return { sessionId: '' }
  }

  if (trimmed.includes('/')) {
    const slash = trimmed.indexOf('/')
    const profile = trimmed.slice(0, slash).trim()
    const sessionId = trimmed.slice(slash + 1).trim()

    if (sessionId) {
      return { profile: profile || undefined, sessionId }
    }
  }

  return { sessionId: trimmed }
}

export function sessionRefCacheKey(value: string): string {
  const { profile, sessionId } = parseSessionRefValue(value)

  if (!sessionId) {
    return ''
  }

  return `${profile ?? ''}/${sessionId}`
}

/** Fallback chip label when the friendly title is not known yet. */
export function sessionRefFallbackLabel(value: string): string {
  const { sessionId } = parseSessionRefValue(value)

  if (!sessionId) {
    return value
  }

  return sessionId.length > 10 ? `${sessionId.slice(0, 8)}…` : sessionId
}

function profileMatches(sessionProfile: string | null | undefined, target?: string): boolean {
  if (!target) {
    return true
  }

  const normalizedTarget = target.trim() || 'default'
  const normalizedSession = (sessionProfile ?? '').trim() || 'default'

  return normalizedSession === normalizedTarget
}

export function lookupLocalSessionTitle(value: string): string {
  const { profile, sessionId } = parseSessionRefValue(value)

  if (!sessionId) {
    return ''
  }

  const row = $sessions.get().find(session => {
    if (!sessionMatchesStoredId(session, sessionId)) {
      return false
    }

    return profileMatches(session.profile, profile)
  })

  return row ? formatSessionTitle(row) : ''
}

export function fetchSessionLinkTitle(value: string): Promise<string> {
  const key = sessionRefCacheKey(value)

  if (!key) {
    return Promise.resolve('')
  }

  if (titleCache.has(key)) {
    return Promise.resolve(titleCache.get(key) ?? '')
  }

  const pending = titleInflight.get(key)

  if (pending) {
    return pending
  }

  const local = lookupLocalSessionTitle(value)

  if (local) {
    titleCache.set(key, local)

    return Promise.resolve(local)
  }

  const { profile, sessionId } = parseSessionRefValue(value)

  const promise = getSession(sessionId, profile ?? null)
    .then(session => formatSessionTitle(session))
    .catch(() => '')
    .then(resolved => {
      const title = resolved.trim()
      titleCache.set(key, title)
      titleInflight.delete(key)
      titleSubs.get(key)?.forEach(sub => sub(title))

      return title
    })

  titleInflight.set(key, promise)

  return promise
}

export function useSessionLinkTitle(value: string, fallbackLabel?: string): string {
  const key = useMemo(() => sessionRefCacheKey(value), [value])
  const fallback = fallbackLabel?.trim() || sessionRefFallbackLabel(value)
  const [title, setTitle] = useState(() => {
    if (!key) {
      return fallback
    }

    return titleCache.get(key) || lookupLocalSessionTitle(value) || fallback
  })

  useEffect(() => {
    if (!key) {
      setTitle(fallback)

      return
    }

    const cached = titleCache.get(key)
    const local = lookupLocalSessionTitle(value)
    const next = cached || local || fallback

    setTitle(next)

    if (cached || local) {
      return
    }

    const subs = titleSubs.get(key) ?? new Set<(resolved: string) => void>()

    subs.add(setTitle)
    titleSubs.set(key, subs)
    void fetchSessionLinkTitle(value)

    return () => {
      subs.delete(setTitle)

      if (!subs.size) {
        titleSubs.delete(key)
      }
    }
  }, [fallback, key, value])

  useEffect(() => {
    if (!key) {
      return
    }

    return $sessions.subscribe(() => {
      const local = lookupLocalSessionTitle(value)

      if (!local) {
        return
      }

      titleCache.set(key, local)
      setTitle(local)
    })
  }, [key, value])

  return title || fallback
}

export function __resetSessionLinkTitleCache(): void {
  titleCache.clear()
  titleInflight.clear()
  titleSubs.clear()
}
