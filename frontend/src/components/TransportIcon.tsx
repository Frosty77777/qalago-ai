import type { Transport } from '../api/types'

const PATHS: Record<Transport, string> = {
  walking: 'M13 4a1.5 1.5 0 1 1 0 .1 M11 21l2-6-2-3 1-4 3 3h3 M9 12l-2 4 M12 8l-3 1-2 3',
  driving: 'M5 17h14v-5l-2-5H7l-2 5z M5 12h14 M7 17v2 M17 17v2 M8 14.5h.01 M16 14.5h.01',
  bicycle: 'M6 18a3 3 0 1 1 0-.1 M18 18a3 3 0 1 1 0-.1 M6 18l4-7h5l3 7 M10 11l-1-3H7 M15 11l-2-4h2',
  public_transport: 'M6 4h12a1 1 0 0 1 1 1v11H5V5a1 1 0 0 1 1-1z M5 11h14 M8 19v-3 M16 19v-3 M8 14h.01 M16 14h.01',
}

export function TransportIcon({ transport, className = 'size-4' }: { transport: Transport; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[transport]} />
    </svg>
  )
}
