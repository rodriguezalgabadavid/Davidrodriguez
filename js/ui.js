// Utilidades de interfaz compartidas por las vistas y el reproductor.

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatDuration(seconds) {
  const totalMin = Math.round((seconds || 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function formatHours(minutes) {
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

export function formatWhen(date, now = new Date()) {
  const d = new Date(date);
  const dayDiff = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  const day = dayDiff === 0 ? 'Hoy' : dayDiff === 1 ? 'Ayer' : dayFmt.format(d).replace(/^\w/, (c) => c.toUpperCase());
  return `${day} · ${timeFmt.format(d)}`;
}

// Valor para <input type="datetime-local"> en hora local.
export function toLocalInput(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Confirmación dentro de la página (confirm() nativo no está disponible en todos los visores).
export function askConfirm(message, confirmLabel, onConfirm) {
  const dialog = document.createElement('div');
  dialog.className = 'confirm';
  dialog.innerHTML = `
    <div class="confirm-box card" role="alertdialog" aria-modal="true">
      <p>${escapeHtml(message)}</p>
      <div class="actions">
        <button class="btn" data-confirm="no">Cancelar</button>
        <button class="btn danger solid" data-confirm="yes">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>`;
  dialog.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-confirm]')?.dataset.confirm;
    if (!choice && event.target !== dialog) return;
    dialog.remove();
    if (choice === 'yes') onConfirm();
  });
  document.body.append(dialog);
  dialog.querySelector('[data-confirm="no"]').focus();
}

let toastTimer;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const relFmt = new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' });

// "hace 5 min", "ayer", "hace 3 días"… y fecha corta a partir de una semana.
export function timeAgo(date, now = new Date()) {
  const diff = (new Date(date) - new Date(now)) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'ahora';
  if (abs < 3600) return relFmt.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relFmt.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return relFmt.format(Math.round(diff / 86400), 'day');
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(date));
}

function hue(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
}

// Avatar redondo: foto si la hay, si no iniciales sobre un color estable por usuario.
export function avatar(profile, size = 'md') {
  const name = escapeHtml(profile?.name ?? '');
  if (profile?.avatarUrl) {
    return `<img class="avatar avatar-${size}" src="${escapeHtml(profile.avatarUrl)}" alt="${name}" loading="lazy" />`;
  }
  return `<span class="avatar avatar-${size}" style="--avatar-h:${hue(profile?.id ?? name)}" role="img" aria-label="${name}">${escapeHtml(initials(profile?.name))}</span>`;
}

export function premiumBadge(profile) {
  return profile?.isPremium ? '<span class="premium-badge" title="Premium">PRO</span>' : '';
}

export function emptyState({ icon = '🎾', title, text = '', action = '' }) {
  return `
    <div class="empty-state">
      <span class="empty-icon" aria-hidden="true">${icon}</span>
      <h2>${escapeHtml(title)}</h2>
      ${text ? `<p class="muted">${escapeHtml(text)}</p>` : ''}
      ${action}
    </div>`;
}

export function loading() {
  return '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span class="muted">Cargando…</span></div>';
}

// Hoja inferior modal (para listas de "¡Vamos!", opciones, etc.). Se cierra tocando fuera o con Escape.
export function sheet(html) {
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `<div class="sheet card" role="dialog" aria-modal="true"><button class="sheet-close icon-plain" data-sheet-close aria-label="Cerrar">✕</button>${html}</div>`;
  const onKey = (e) => e.key === 'Escape' && close();
  function close() {
    el.remove();
    document.removeEventListener('keydown', onKey);
  }
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-sheet-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  el.querySelector('.sheet').focus?.();
  return { el, close };
}
