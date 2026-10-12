// Iconos de línea propios (24×24, trazo 2, extremos redondeados). Heredan el color del texto
// (currentColor) y son decorativos: el texto o el aria-label del botón dice qué hacen.

const PATHS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h5v-6h3v6h5V9"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4.5v1a3.5 3.5 0 0 0 3.6 3.5"/><path d="M16 6h3.5v1a3.5 3.5 0 0 1-3.6 3.5"/><path d="M12 13v4"/><path d="M8.5 20.5h7"/><path d="M10 17h4l.5 3.5h-5L10 17Z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  dumbbell: '<path d="M6.5 7v10"/><path d="M3.5 9.5v5"/><path d="M17.5 7v10"/><path d="M20.5 9.5v5"/><path d="M6.5 12h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5a3.5 3.5 0 0 1 0 7"/><path d="M17.5 14.2A6.5 6.5 0 0 1 21.5 20"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 21h4"/>',
  // Pala de pádel: el icono del "¡Vamos!" (los kudos de PadelFit).
  racket: '<path d="M14.6 13.3a6 6 0 1 0-4.9-9.8 6 6 0 0 0 4.9 9.8Z"/><path d="m11 13.5-1.5 1.5"/><path d="m9.5 15 4.8 4.8a1.4 1.4 0 0 1-2 2L7.5 17"/><circle cx="11.8" cy="6.6" r=".5" fill="currentColor"/><circle cx="14.6" cy="8" r=".5" fill="currentColor"/><circle cx="11" cy="9.6" r=".5" fill="currentColor"/>',
  comment: '<path d="M4 5.5h16v10.5H10l-6 4.5V5.5Z"/>',
  back: '<path d="M15 18.5 8.5 12 15 5.5"/>',
  chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  camera: '<path d="M3.5 8.5h3.5l1.8-2.8h6.4L17 8.5h3.5v11h-17v-11Z"/><circle cx="12" cy="13.5" r="3.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flame: '<path d="M12 3c.8 2.8 5.5 5 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.6 1.4-4.2 2.5-5.2.3 1.6 1 2.6 2 3.1.4-2.6-.3-5.6 1-8.1Z"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3.5v4"/><path d="M15 3.5v4"/>',
  sliders: '<path d="M4 7h9"/><path d="M18 7h2"/><circle cx="15.5" cy="7" r="2.2"/><path d="M4 17h3"/><path d="M12 17h8"/><circle cx="9.5" cy="17" r="2.2"/>',
  crown: '<path d="M4.5 18.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1.5 11h-15Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6c2.8 2.6 2.8 9.4 0 12"/><path d="M18 6c-2.8 2.6-2.8 9.4 0 12"/>',
  bolt: '<path d="M13 3 5.5 13.5h5.5L10 21l8-11h-5.5L13 3Z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11.5a6.5 6.5 0 0 0-13 0C5.5 15 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.3"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9.5 8"/>',
  play: '<path d="M7.5 4.5v15l12-7.5-12-7.5Z"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  next: '<path d="M5.5 5.5v13l9.5-6.5-9.5-6.5Z"/><path d="M18.5 5.5v13"/>',
  prev: '<path d="M18.5 5.5v13L9 12l9.5-6.5Z"/><path d="M5.5 5.5v13"/>',
  medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 3.5 10.3 9.7"/><path d="M15.5 3.5l-1.8 6.2"/><path d="M8 3.5h8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  logout: '<path d="M14.5 4.5h4v15h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10v4Z"/><path d="m13 7 4 4"/>',
  share: '<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 13v6.5h14V13"/>',
  list: '<path d="M9 6.5h11"/><path d="M9 12h11"/><path d="M9 17.5h11"/><circle cx="5" cy="6.5" r=".8" fill="currentColor"/><circle cx="5" cy="12" r=".8" fill="currentColor"/><circle cx="5" cy="17.5" r=".8" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
};

export const ICON_NAMES = Object.keys(PATHS);

// icon('racket') → <svg …>. size en px; className opcional para estilos concretos.
export function icon(name, { size = 24, className = '' } = {}) {
  const paths = PATHS[name];
  if (!paths) return '';
  return `<svg class="icon icon-${name}${className ? ` ${className}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

// Icono de cada tipo de actividad (sustituye a los emojis en la interfaz).
export const TYPE_ICONS = { partido: 'ball', clase: 'target', entreno: 'bolt' };
