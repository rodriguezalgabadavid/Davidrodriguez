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
