// Контурные иконки интерфейса (24×24, цвет берётся из currentColor)
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconHome = () => (
  <svg {...base}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v11h5v-6h4v6h5V9" /></svg>
);
export const IconTrophy = () => (
  <svg {...base}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M16 6h3v2a3 3 0 0 1-3 3M8 6H5v2a3 3 0 0 0 3 3" /><path d="M12 13v4M8 21h8M9 21l1-4h4l1 4" /></svg>
);
export const IconUsers = () => (
  <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></svg>
);
export const IconServer = () => (
  <svg {...base}><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" /></svg>
);
export const IconMap = () => (
  <svg {...base}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>
);
export const IconLogin = () => (
  <svg {...base}><path d="M14 4h5v16h-5" /><path d="M10 8l4 4-4 4M14 12H3" /></svg>
);
export const IconLogout = () => (
  <svg {...base}><path d="M10 4H5v16h5" /><path d="M15 8l4 4-4 4M19 12H9" /></svg>
);
export const IconGlobe = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><ellipse cx="12" cy="12" rx="4" ry="9" /></svg>
);
export const IconShield = () => (
  <svg {...base}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconMore = () => (
  <svg {...base}><path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} /></svg>
);
export const IconUp = () => (
  <svg {...base}><path d="m6 15 6-6 6 6" /></svg>
);
export const IconDown = () => (
  <svg {...base}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconChevron = () => (
  <svg {...base}><path d="m9 6 6 6-6 6" /></svg>
);
export const IconClose = () => (
  <svg {...base}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconExpand = () => (
  <svg {...base}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
);
export const IconShuffle = () => (
  <svg {...base}><path d="M3 7h3.5c5 0 6 10 11 10H21" /><path d="M3 17h3.5c1.8 0 3-1.3 4-3M14 8.5c1-.9 2-1.5 3.500-1.500H21" /><path d="m18 4 3 3-3 3M18 14l3 3-3 3" /></svg>
);
export const IconStar = () => (
  <svg {...base}><path d="m12 4 2.400 5 5.600.8-4 3.900.9 5.500-4.900-2.600-4.900 2.600.9-5.500-4-3.900 5.600-.8L12 4Z" fill="currentColor" /></svg>
);
