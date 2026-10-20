import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Language, User } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import { errorMessage } from '../lib/errors'

// Minimal typing for Google Identity Services (https://developers.google.com/identity/gsi/web).
interface GoogleId {
  initialize(config: Record<string, unknown>): void
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void
  prompt(): void
  disableAutoSelect(): void
  cancel(): void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client'
let gsiPromise: Promise<GoogleId> | null = null

function loadGsi(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  gsiPromise ??= new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('GIS missing')))
    script.onerror = () => {
      gsiPromise = null
      reject(new Error('GIS failed to load'))
    }
    document.head.appendChild(script)
  })
  return gsiPromise
}

interface Props {
  clientId: string | null
  user: User | null
  /** True once the session check finished, so One Tap never appears for a signed-in user. */
  restored: boolean
  lang: Language
  compact: boolean
  onUser: (u: User | null) => void
}

export function AuthControl({ clientId, user, restored, lang, compact, onUser }: Props) {
  const { t } = useI18n()
  const buttonRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [error, setError] = useState<ApiError | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const handlers = useRef({ onUser })
  useEffect(() => {
    handlers.current = { onUser }
  }, [onUser])

  useEffect(() => {
    if (!clientId || user || !restored) return
    let cancelled = false
    loadGsi()
      .then((gsi) => {
        if (cancelled || !buttonRef.current) return
        gsi.initialize({
          client_id: clientId,
          // The credential is a signed ID token; only the backend decides who the user is.
          callback: async ({ credential }: { credential?: string }) => {
            if (!credential) return
            setState('loading')
            setError(null)
            try {
              const res = await api.signInWithGoogle(credential)
              handlers.current.onUser(res.user)
              setState('idle')
            } catch (err) {
              setError(err instanceof ApiError ? err : new ApiError('auth_failed', String(err)))
              setState('idle')
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin',
          ux_mode: 'popup',
          itp_support: true,
          use_fedcm_for_prompt: true,
        })
        buttonRef.current.replaceChildren()
        gsi.renderButton(buttonRef.current, {
          type: compact ? 'icon' : 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          locale: lang,
        })
        // One Tap is a progressive enhancement; the button above always stays available.
        gsi.prompt()
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
      window.google?.accounts?.id?.cancel()
    }
  }, [clientId, user, restored, lang, compact])

  if (!clientId) return null

  if (user) {
    const name = user.name ?? user.email ?? t('account')
    return (
      <div className="relative">
        <button
          type="button"
          className="flex min-h-10 items-center gap-2 rounded-full border border-slate-300 bg-white py-1 pr-3 pl-1 text-sm font-medium"
          aria-expanded={menuOpen}
          aria-haspopup="true"
          onClick={() => setMenuOpen(!menuOpen)}
          data-testid="account-button"
        >
          {user.picture ? (
            <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full" />
          ) : (
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-slate-900 text-amber-300">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="sr-only sm:not-sr-only sm:max-w-32 sm:truncate">{name}</span>
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-[1200] mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg" role="menu">
            <p className="break-words text-slate-700">{t('signedInAs', { name })}</p>
            <button
              type="button"
              role="menuitem"
              className="btn-secondary mt-2 w-full"
              data-testid="sign-out"
              onClick={async () => {
                setMenuOpen(false)
                try {
                  await api.signOut()
                } catch {
                  // The session cookie is HttpOnly; if the server is unreachable it simply expires.
                }
                window.google?.accounts?.id?.disableAutoSelect()
                onUser(null)
              }}
            >
              {t('signOut')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-10 items-center" data-testid="sign-in">
      <div ref={buttonRef} aria-busy={state === 'loading'} />
      {state === 'failed' && <span className="text-xs text-rose-700">{t('authLoadFailed')}</span>}
      {error && (
        <span role="alert" className="ml-2 max-w-48 text-xs text-rose-700">
          {errorMessage(t, error)}
        </span>
      )}
    </div>
  )
}
