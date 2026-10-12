import { KUDOS_EVENT, activityCard, demoTag, globalActions, updateCommentCount } from '../components.js';
import { askConfirm, avatar, emptyState, escapeHtml, formatWhen, premiumBadge, timeAgo, toast } from '../ui.js';

// Detalle de una actividad: tarjeta completa, quién ha dado "¡Vamos!", comentarios y caja para comentar.

const MAX_COMMENT = 500;

// Estado de la vista montada (para los listeners del documento y las acciones).
let state = null; // { id, isMine, meId, onKudos }

function cleanup() {
  if (state?.onKudos) document.removeEventListener(KUDOS_EVENT, state.onKudos);
  state = null;
}

const profileLink = (id) => `href="#perfil" data-route="perfil" data-param-id="${escapeHtml(id)}"`;

// ---------- Fragmentos ----------

function kudoersRow(activityId, isMine, kudoers, meId) {
  if (!kudoers.length) {
    return `<p class="act-kudoers-empty muted">${isMine
      ? 'Aún nadie te ha dado ¡Vamos! en esta actividad.'
      : 'Sé el primero en darle ¡Vamos! 🙌'}</p>`;
  }
  const names = kudoers.slice(0, 2).map((p) => (p.id === meId ? 'Tú' : p.name));
  const rest = kudoers.length - names.length;
  const who = rest > 0 ? `${names.join(', ')} y ${rest} más` : names.join(' y ');
  return `
    <button class="act-kudoers-btn" data-action="show-kudoers" data-id="${escapeHtml(activityId)}">
      <span class="act-stack" aria-hidden="true">${kudoers.slice(0, 5).map((p) => avatar(p, 'sm')).join('')}</span>
      <span class="act-kudoers-text"><strong>🙌 ${kudoers.length} ¡Vamos!</strong> · ${escapeHtml(who)}</span>
    </button>`;
}

// canDelete: el autor del comentario o el dueño de la actividad (modera su publicación).
function commentItem(c, now, canDelete = c.isMine) {
  const author = c.author ?? { id: '', name: 'Jugador' };
  return `
    <li class="cm-item" data-comment-id="${escapeHtml(c.id)}">
      <a class="cm-avatar" ${profileLink(author.id)} tabindex="-1" aria-hidden="true">${avatar(author, 'sm')}</a>
      <div class="cm-body">
        <div class="cm-head">
          <a class="cm-name" ${profileLink(author.id)}>${escapeHtml(author.name)}</a>${premiumBadge(author)}${demoTag(author)}
          <time class="cm-time" datetime="${escapeHtml(c.createdAt)}" title="${escapeHtml(formatWhen(c.createdAt, now))}">${escapeHtml(timeAgo(c.createdAt, now))}</time>
          ${canDelete ? `<button class="cm-delete" data-action="delete-comment" data-comment-id="${escapeHtml(c.id)}" aria-label="Borrar comentario">✕</button>` : ''}
        </div>
        <p class="cm-text">${escapeHtml(c.text)}</p>
      </div>
    </li>`;
}

function syncCommentCount(id) {
  const list = document.getElementById('cm-list');
  const n = list ? list.children.length : 0;
  updateCommentCount(id, n);
  const empty = document.querySelector('.cm-empty');
  if (empty) empty.hidden = n > 0;
}

function notFound() {
  return `
    <section class="act-view">
      ${emptyState({
        icon: '🔍',
        title: 'Esta actividad ya no existe',
        text: 'Puede que su autor la haya borrado.',
        action: '<button class="btn primary" data-route="inicio">Volver al inicio</button>',
      })}
    </section>`;
}

function focusComment({ scroll = true } = {}) {
  const input = document.querySelector('.cm-input');
  if (!input) return;
  input.focus({ preventScroll: !scroll });
}

// ---------- Vista ----------

export default {
  route: 'actividad',
  tab: 'inicio',

  async render(ctx) {
    const id = ctx.params.id;
    const [activity, comments, kudoers] = await Promise.all([
      ctx.backend.getActivity(id),
      ctx.backend.getComments(id).catch(() => []),
      ctx.backend.getKudoers(id).catch(() => []),
    ]);
    if (!activity) return notFound();

    ctx.cache.drafts ??= {};
    const draft = ctx.cache.drafts[id] ?? '';
    const n = comments.length;

    return `
      <section class="act-view" data-activity="${escapeHtml(id)}" data-mine="${activity.isMine ? '1' : ''}">
        <div class="act-topbar">
          <button class="link act-back" data-action="back">← Volver</button>
          ${activity.isMine ? '<button class="act-delete" data-action="delete-activity">🗑️ Borrar</button>' : ''}
        </div>

        ${activityCard(activity, ctx, { link: false })}

        <div class="act-kudoers" id="act-kudoers">${kudoersRow(id, activity.isMine, kudoers, ctx.me?.id)}</div>

        <section class="card cm-section" aria-labelledby="cm-title">
          <h2 id="cm-title" class="cm-title">Comentarios <span class="cm-count" data-cm-for="${escapeHtml(id)}"${n ? '' : ' hidden'}>${n}</span></h2>
          <ol class="cm-list" id="cm-list">${comments.map((c) => commentItem(c, ctx.now, c.isMine || activity.isMine)).join('')}</ol>
          <p class="cm-empty muted"${n ? ' hidden' : ''}>Aún no hay comentarios. ¡Anímale con el primero!</p>
        </section>

        <form class="cm-form" data-submit="comment" autocomplete="off">
          ${avatar(ctx.me, 'sm')}
          <input class="input cm-input" name="text" type="text" maxlength="${MAX_COMMENT}" value="${escapeHtml(draft)}"
            placeholder="Escribe un comentario…" aria-label="Escribe un comentario" enterkeyhint="send" data-input="draft" />
          <button class="btn primary cm-send" type="submit">Enviar</button>
        </form>
      </section>`;
  },

  mount(root, ctx) {
    cleanup();
    const view = root.querySelector('.act-view[data-activity]');
    if (!view) return;
    const id = view.dataset.activity;
    const isMine = view.dataset.mine === '1';
    const meId = ctx.me?.id;

    // Si das "¡Vamos!" desde la tarjeta, se actualiza la fila de quién lo ha dado.
    const onKudos = async (event) => {
      if (event.detail?.id !== id) return;
      try {
        const kudoers = await ctx.backend.getKudoers(id);
        const row = document.getElementById('act-kudoers');
        if (row && state?.id === id) row.innerHTML = kudoersRow(id, isMine, kudoers, meId);
      } catch {
        // No es crítico: la próxima vez que se abra estará al día.
      }
    };
    document.addEventListener(KUDOS_EVENT, onKudos);
    state = { id, isMine, onKudos };

    // Desde el botón de comentar de una tarjeta: foco en la caja (una vez por navegación, no en cada repintado).
    if (ctx.params.focus === 'comment' && ctx.cache.focusedFor !== ctx.params) {
      ctx.cache.focusedFor = ctx.params;
      requestAnimationFrame(() => focusComment());
    }
  },

  unmount() {
    cleanup();
  },

  actions: {
    back(el, ctx) {
      ctx.back();
    },

    // Dentro del detalle, el botón de comentar lleva a la caja de comentarios.
    'open-activity'(el, ctx) {
      if (el.dataset.id === state?.id) return focusComment();
      return globalActions['open-activity'](el, ctx);
    },

    draft(el, ctx) {
      if (!state) return;
      ctx.cache.drafts ??= {};
      ctx.cache.drafts[state.id] = el.value;
    },

    async comment(form, ctx) {
      if (!state || form.dataset.busy) return;
      const id = state.id;
      const input = form.elements.text;
      const text = input.value.trim();
      if (!text) {
        toast('Escribe algo antes de enviar.');
        input.focus();
        return;
      }
      if (text.length > MAX_COMMENT) {
        toast(`Máximo ${MAX_COMMENT} caracteres.`);
        return;
      }
      const button = form.querySelector('.cm-send');
      form.dataset.busy = '1';
      button.disabled = true;
      try {
        const comment = await ctx.backend.addComment(id, text);
        const list = document.getElementById('cm-list');
        list?.insertAdjacentHTML('beforeend', commentItem(comment, new Date()));
        input.value = '';
        if (ctx.cache.drafts) delete ctx.cache.drafts[id];
        syncCommentCount(id);
        list?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } finally {
        delete form.dataset.busy;
        button.disabled = false;
        input.focus({ preventScroll: true });
      }
    },

    'delete-comment'(el, ctx) {
      const commentId = el.dataset.commentId;
      const id = state?.id;
      if (!commentId || !id) return;
      askConfirm('¿Borrar este comentario?', 'Borrar', async () => {
        try {
          await ctx.backend.deleteComment(commentId);
          el.closest('.cm-item')?.remove();
          syncCommentCount(id);
          toast('Comentario borrado');
        } catch (error) {
          toast(error.message || 'No se ha podido borrar el comentario.');
        }
      });
    },

    'delete-activity'(el, ctx) {
      const id = state?.id;
      if (!id || !state.isMine) return;
      askConfirm('¿Borrar esta actividad? Se perderán sus ¡Vamos! y comentarios.', 'Borrar', async () => {
        try {
          await ctx.backend.deleteActivity(id);
          toast('Actividad borrada');
          ctx.navigate('inicio');
        } catch (error) {
          toast(error.message || 'No se ha podido borrar la actividad.');
        }
      });
    },
  },
};
