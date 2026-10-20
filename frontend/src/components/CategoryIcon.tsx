// Simple stroke icons per intent category, drawn inline (no image assets, no photos of venues).
const PATHS: Record<string, string> = {
  coffee: 'M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z M16 10h1.5a2.5 2.5 0 0 1 0 5H16 M8 2v3 M12 2v3',
  food: 'M7 2v8 M5 2v5a2 2 0 0 0 4 0V2 M7 10v12 M18 2c-2 2-3 5-3 8h3v12',
  park: 'M12 22v-6 M12 2l6 9h-3l4 5H5l4-5H6z',
  kids: 'M12 2a5 5 0 0 1 5 5c0 4-5 8-5 8s-5-4-5-8a5 5 0 0 1 5-5z M12 15v7',
  museum: 'M3 21h18 M4 10h16 M12 3l9 7H3z M6 10v11 M10 10v11 M14 10v11 M18 10v11',
  study: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  sights: 'M12 2l3 6v14H9V8z M5 22h14',
  place: 'M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z M12 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
}

export function CategoryIcon({ category, className = 'size-5' }: { category: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[category] ?? PATHS.place} />
    </svg>
  )
}
