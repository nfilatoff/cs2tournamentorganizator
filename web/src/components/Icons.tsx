// Контурные иконки для навигации (24×24, цвет берётся из currentColor)
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

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
