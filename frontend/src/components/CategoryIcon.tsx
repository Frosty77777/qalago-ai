// Simple stroke icons per category group, drawn inline (no image assets, no photos of venues).
const PATHS: Record<string, string> = {
  food: 'M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z M16 10h1.5a2.5 2.5 0 0 1 0 5H16 M8 2v3 M12 2v3',
  dining: 'M7 2v8 M5 2v5a2 2 0 0 0 4 0V2 M7 10v12 M18 2c-2 2-3 5-3 8h3v12',
  nature: 'M12 22v-6 M12 2l6 9h-3l4 5H5l4-5H6z',
  kids: 'M12 2a5 5 0 0 1 5 5c0 4-5 8-5 8s-5-4-5-8a5 5 0 0 1 5-5z M12 15v7',
  culture: 'M3 21h18 M4 10h16 M12 3l9 7H3z M6 10v11 M10 10v11 M14 10v11 M18 10v11',
  books: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  landmark: 'M12 2l3 6v14H9V8z M5 22h14',
  view: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  art: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
}

const GROUP: Record<string, keyof typeof PATHS> = {
  cafe: 'food',
  restaurant: 'dining',
  park: 'nature',
  garden: 'nature',
  playground: 'kids',
  museum: 'culture',
  gallery: 'culture',
  theatre: 'culture',
  library: 'books',
  attraction: 'landmark',
  monument: 'landmark',
  memorial: 'landmark',
  historic: 'landmark',
  viewpoint: 'view',
  artwork: 'art',
}

export function CategoryIcon({ category, className = 'size-5' }: { category: string; className?: string }) {
  const d = PATHS[GROUP[category] ?? 'landmark']
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
