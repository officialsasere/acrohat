const paths: Record<string, string> = {
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  select: 'M5 4l14 6-6 2-2 6z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  highlight: 'm9 11 6 6-4 3-5-1-1-5zM14 6l4 4M5 21h6',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 21h14',
  strikeout: 'M5 12h14M16 7c-1-2-8-3-8 1 0 4 8 2 8 6 0 3-6 4-8 1',
  pen: 'M3 17c3-8 5-9 6-6s3 2 5-2 4-2 7 3',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z',
  note: 'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  sign: 'M3 18c2 0 3-6 5-6s0 6 2 6 2-4 4-4 1 3 3 3h4M4 21h16',
  redact: 'M4 8h16v8H4zM8 12h8',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l5 5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  rotate: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  close: 'M6 6l12 12M18 6 6 18',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  merge: 'M6 4v6a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6V4M12 16v5',
  split: 'M12 3v6M12 9 5 20M12 9l7 11',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  extract: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01',
  print: 'M7 9V3h10v6M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z',
  speaker: 'M4 10v4h4l5 4V6l-5 4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  panel: 'M4 5h16v14H4zM15 5v14',
  tools: 'M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-2.6-.6-.6-2.6z',
}

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] ?? ''} />
    </svg>
  )
}
