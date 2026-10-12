import { demoTag } from '../components.js';
import { avatar, emptyState, escapeHtml, formatWhen, timeAgo } from '../ui.js';

// Notificaciones: "¡Vamos!", comentarios y nuevos seguidores, de la más reciente a la más antigua.
// Al abrir la pantalla se marcan como leídas; las que eran nuevas siguen destacadas mientras
// sigas aquí (aunque la lista se repinte al llegar otra).

const KIND_ICON = { kudos: '🙌', comment: '💬', follow: '👋' };
const NOUN = { partido: 'tu partido', clase: 'tu clase', entreno: 'tu entreno' };
const PREVIEW_MAX = 80; // el backend guarda los primeros 80 caracteres del comentario

let shownAsNew = new Set();
let needsMarkRead = false;

function sentence(n, activity) {
  const name = `<strong>${escapeHtml(n.actor?.name || 'Alguien')}</strong>`;
  const noun = NOUN[activity?.type] ?? 'tu actividad';
  if (n.kind === 'kudos') return `A ${name} le ha gustado ${noun}`;
  if (n.kind === 'follow') return `${name} ha empezado a seguirte`;
  if (n.kind === 'comment') {
    const preview = String(n.preview ?? '').trim();
    if (!preview) return `${name} ha comentado ${noun}`;
    const cut = preview.length >= PREVIEW_MAX ? '…' : '';
    return `${name} ha comentado: «${escapeHtml(preview)}${cut}»`;
  }
  return `${name} ha interactuado contigo`;
}

function item(n, activity, now, isNew) {
  const actor = n.actor ?? { id: '', name: 'Alguien', avatarUrl: null, isPremium: false };
  const kind = KIND_ICON[n.kind] ? n.kind : 'kudos';
  let target = '';
  if (n.activityId) target = `href="#actividad" data-route="actividad" data-param-id="${escapeHtml(n.activityId)}"`;
  else if (actor.id) target = `href="#perfil" data-route="perfil" data-param-id="${escapeHtml(actor.id)}"`;
  const tag = target ? 'a' : 'div';
  const thumb = activity?.photoUrl
    ? `<img class="notif-thumb" src="${escapeHtml(activity.photoUrl)}" alt="" loading="lazy" decoding="async" />`
    : '';
  return `
    <li>
      <${tag} class="notif-item${isNew ? ' notif-new' : ''}" ${target}>
        <span class="notif-avatar">
          ${avatar(actor)}
          <span class="notif-kind notif-kind-${kind}" aria-hidden="true">${KIND_ICON[kind]}</span>
        </span>
        <span class="notif-body">
          <span class="notif-text">${sentence(n, activity)}</span>
          <span class="notif-meta">
            <time datetime="${escapeHtml(n.createdAt)}" title="${escapeHtml(formatWhen(n.createdAt, now))}">${escapeHtml(timeAgo(n.createdAt, now))}</time>
            ${demoTag(actor)}
          </span>
        </span>
        ${thumb}
        ${isNew ? '<span class="notif-dot" aria-hidden="true"></span>' : ''}
      </${tag}>
    </li>`;
}

function group(title, list, byId, now, isNew) {
  if (!list.length) return '';
  return `
    <section class="notif-group" aria-label="${escapeHtml(title)}">
      <h2 class="notif-group-title">${escapeHtml(title)}${isNew ? ` <span class="notif-group-count">${list.length}</span>` : ''}</h2>
      <ul class="notif-list">
        ${list.map((n) => item(n, byId.get(n.activityId), now, isNew)).join('')}
      </ul>
    </section>`;
}

export default {
  route: 'notificaciones',
  tab: null,

  async render(ctx) {
    const [list, mine] = await Promise.all([
      ctx.backend.getNotifications({ limit: 50 }),
      // Para saber si el "¡Vamos!" es a un partido, una clase o un entreno, y enseñar su foto.
      ctx.backend.getMyActivities().catch(() => []),
    ]);
    const byId = new Map(mine.map((a) => [a.id, a]));
    const sorted = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    needsMarkRead = sorted.some((n) => !n.read);
    const isNew = (n) => !n.read || shownAsNew.has(n.id);
    const fresh = sorted.filter(isNew);
    const older = sorted.filter((n) => !isNew(n));
    for (const n of fresh) shownAsNew.add(n.id);

    if (!sorted.length) {
      return `
        <section class="notif-view">
          <h1 class="notif-heading">Notificaciones</h1>
          ${emptyState({
            icon: '🔔',
            title: 'Todavía no hay nada por aquí',
            text: 'Cuando alguien te dé ¡Vamos!, comente tus actividades o empiece a seguirte, lo verás aquí.',
            action: '<button class="btn primary" data-route="buscar">Buscar jugadores</button>',
          })}
        </section>`;
    }

    return `
      <section class="notif-view">
        <h1 class="notif-heading">Notificaciones</h1>
        ${fresh.length ? '' : '<p class="notif-uptodate muted">Estás al día ✨</p>'}
        ${group('Nuevas', fresh, byId, ctx.now, true)}
        ${group('Anteriores', older, byId, ctx.now, false)}
      </section>`;
  },

  mount(root, ctx) {
    if (!needsMarkRead) {
      ctx.refreshBadge();
      return;
    }
    needsMarkRead = false;
    ctx.backend.markNotificationsRead()
      .catch(() => {}) // si falla, seguirán como nuevas la próxima vez
      .finally(() => ctx.refreshBadge());
  },

  unmount() {
    shownAsNew = new Set();
    needsMarkRead = false;
  },
};
