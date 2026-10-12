import { activityTitle, formatScore } from '../activities.js';
import { challengeProgress, completedChallenges, currentChallenges } from '../challenges.js';
import { achievements, newlyUnlocked, weeklyStreak } from '../stats.js';
import { escapeHtml, formatDuration } from '../ui.js';

// Pantalla de celebración tras publicar: compara una "foto" del progreso (logros, retos y racha)
// de antes y de después de la actividad y enseña lo que ha cambiado.

// Snapshot a partir de datos ya cargados (publish.js lo usa en el render para no pedirlos dos veces).
export function snapshotFrom({ activities = [], joined = [], planState = null } = {}, now = new Date()) {
  const mine = Array.isArray(activities) ? activities : [];
  const joinedIds = Array.isArray(joined) ? joined : [];
  const joinedSet = new Set(joinedIds);
  const challenges = currentChallenges(now)
    .filter((c) => joinedSet.has(c.instanceId))
    .map((c) => {
      const p = challengeProgress(c, mine, now);
      return { instanceId: c.instanceId, title: c.title, icon: c.icon, value: p.value, target: p.target, done: p.done };
    });
  return {
    achievements: achievements(mine, {
      completedChallenges: completedChallenges(joinedIds, mine),
      finishedPlans: planState?.finished ?? [],
    }),
    challenges,
    streak: weeklyStreak(mine, now),
  };
}

export async function snapshot(ctx) {
  const { backend } = ctx;
  const [activities, joined, planState] = await Promise.all([
    backend.getMyActivities(),
    backend.getJoinedChallenges().catch(() => []),
    backend.getPlanState().catch(() => null),
  ]);
  return snapshotFrom({ activities, joined, planState }, new Date());
}

const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const CONFETTI_COLORS = ['--accent', '--primary', '--t-partido', '--t-clase', '--win', '--loss'];
const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function headline(activity) {
  if (activity?.type === 'partido') {
    if (activity.won === true) return { icon: '🏆', title: '¡Victoria publicada!', text: '' };
    if (activity.won === false) return { icon: '💪', title: '¡Partido publicado!', text: 'Hoy no salió, pero ya suma. ¡A por la revancha!' };
    return { icon: '🎾', title: '¡Partido publicado!', text: '' };
  }
  if (activity?.type === 'clase') return { icon: '🎯', title: '¡Clase completada!', text: '' };
  return { icon: '⚡', title: '¡Entreno completado!', text: '' };
}

function subtitle(activity) {
  if (!activity) return '';
  const parts = [];
  if (activity.type === 'partido') {
    if (activity.sets?.length) parts.push(formatScore(activity.sets));
    if (activity.partner) parts.push(`con ${activity.partner}`);
  } else {
    parts.push(activityTitle(activity));
  }
  if (activity.seconds) parts.push(formatDuration(activity.seconds));
  return parts.join(' · ');
}

function pct(value, target) {
  return target ? Math.min(100, Math.round((value / target) * 100)) : 0;
}

// Qué ha cambiado entre los dos snapshots. Si falta alguno, no se puede comparar: nada "nuevo".
export function diffSnapshots(before, after) {
  if (!before || !after) {
    return { unlocked: [], progressed: [], streak: after?.streak ?? null, streakGrew: false };
  }
  const prev = new Map((before.challenges ?? []).map((c) => [c.instanceId, c]));
  const progressed = (after.challenges ?? [])
    .map((c) => ({ ...c, before: prev.get(c.instanceId) }))
    .filter((c) => c.before && c.value > c.before.value)
    .map((c) => ({ ...c, completedNow: c.done && !c.before.done }));
  return {
    unlocked: newlyUnlocked(before.achievements, after.achievements),
    progressed,
    streak: after.streak ?? null,
    streakGrew: Boolean(after.streak && before.streak && after.streak.weeks > before.streak.weeks),
  };
}

function confetti() {
  const pieces = Array.from({ length: 28 }, (_, i) => {
    const x = (i * 37 + 11) % 100;
    const delay = ((i * 7) % 10) / 10;
    const dur = 1.8 + ((i * 13) % 10) / 10;
    const rot = (i * 53) % 360;
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    return `<i style="--x:${x}%;--d:${delay}s;--t:${dur}s;--r:${rot}deg;--c:var(${color})"></i>`;
  });
  return `<div class="cel-confetti" aria-hidden="true">${pieces.join('')}</div>`;
}

function achievementsHtml(list) {
  if (!list.length) return '';
  return `
    <section class="cel-section">
      <h3 class="cel-label">${list.length > 1 ? 'Logros desbloqueados' : 'Logro desbloqueado'}</h3>
      <ul class="cel-list">
        ${list.map((a, i) => `
          <li class="cel-item cel-achievement cel-pop" style="--i:${i}">
            <span class="cel-item-icon" aria-hidden="true">${escapeHtml(a.icon)}</span>
            <span class="cel-item-body">
              <strong>${escapeHtml(a.label)}</strong>
              <span class="muted">${escapeHtml(a.description)}</span>
            </span>
          </li>`).join('')}
      </ul>
    </section>`;
}

function challengesHtml(list, offset) {
  if (!list.length) return '';
  return `
    <section class="cel-section">
      <h3 class="cel-label">Retos</h3>
      <ul class="cel-list">
        ${list.map((c, i) => `
          <li class="cel-item cel-challenge cel-pop${c.completedNow ? ' cel-done' : ''}" style="--i:${offset + i}">
            <span class="cel-item-icon" aria-hidden="true">${escapeHtml(c.icon)}</span>
            <span class="cel-item-body">
              <strong>${c.completedNow ? '¡Reto completado!' : escapeHtml(c.title)}</strong>
              ${c.completedNow ? `<span class="muted">${escapeHtml(c.title)}</span>` : ''}
              <span class="cel-progress-text">
                ${escapeHtml(numFmt.format(c.before.value))} → <strong>${escapeHtml(numFmt.format(c.value))}</strong> / ${escapeHtml(numFmt.format(c.target))}
              </span>
              <span class="cel-bar" aria-hidden="true">
                <span style="--from:${pct(c.before.value, c.target)}%;--to:${pct(c.value, c.target)}%"></span>
              </span>
            </span>
          </li>`).join('')}
      </ul>
    </section>`;
}

function streakHtml(streak, grew, index) {
  if (!streak?.weeks) return '';
  const weeks = streak.weeks;
  const label = `🔥 ${weeks} ${weeks === 1 ? 'semana' : 'semanas'} ${weeks === 1 ? 'en racha' : 'seguidas'}`;
  const text = grew
    ? weeks === 1
      ? '¡Racha iniciada! Haz algo cada semana para alargarla.'
      : 'Una actividad por semana y la racha sigue creciendo.'
    : 'Esta semana ya cuenta para tu racha.';
  return `
    <section class="cel-section">
      <div class="cel-item cel-streak${grew ? ' cel-pop' : ''}" style="--i:${index}">
        <span class="cel-item-body">
          <strong>${escapeHtml(label)}${grew ? ' <span class="cel-plus">+1</span>' : ''}</strong>
          <span class="muted">${escapeHtml(text)}</span>
        </span>
      </div>
    </section>`;
}

function celebrationHtml(ctx, { activity, before, after }) {
  const head = headline(activity);
  const sub = subtitle(activity);
  const diff = diffSnapshots(before, after);
  const nothingNew = !diff.unlocked.length && !diff.progressed.length && !diff.streakGrew;
  const demo = ctx?.backend?.mode === 'demo';
  const photo = activity?.photoUrl
    ? `<img class="cel-photo" src="${escapeHtml(activity.photoUrl)}" alt="Foto de tu actividad" />`
    : `<span class="cel-icon" aria-hidden="true">${head.icon}</span>`;

  return `
    ${confetti()}
    <div class="cel-box" role="dialog" aria-modal="true" aria-labelledby="cel-title" aria-describedby="cel-sub">
      <header class="cel-head">
        ${photo}
        <h2 id="cel-title" class="cel-title">${escapeHtml(head.title)}</h2>
        <p id="cel-sub" class="cel-sub">${escapeHtml(sub)}</p>
        ${head.text ? `<p class="cel-sub">${escapeHtml(head.text)}</p>` : ''}
      </header>
      ${achievementsHtml(diff.unlocked)}
      ${challengesHtml(diff.progressed, diff.unlocked.length)}
      ${streakHtml(diff.streak, diff.streakGrew, diff.unlocked.length + diff.progressed.length)}
      ${nothingNew ? '<p class="cel-cheer">Ya está en tu muro y en tu perfil. ¡Cada actividad cuenta!</p>' : ''}
      <p class="cel-hint">👏 Tus amigos ya pueden darte ¡Vamos!${demo ? ' <span class="muted">(En la demo reaccionan jugadores de ejemplo.)</span>' : ''}</p>
      <button type="button" class="btn primary big cel-close" data-cel-close>¡Seguir!</button>
    </div>`;
}

// Modal a pantalla completa. Se resuelve cuando el usuario la cierra (botón, Escape o cambio de ruta).
export function showCelebration(ctx, { activity, before = null, after = null } = {}) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'cel-backdrop';
    overlay.innerHTML = celebrationHtml(ctx, { activity, before, after });

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('hashchange', close);
      document.body.classList.remove('no-scroll');
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus?.();
      resolve();
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...overlay.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.getClientRects().length);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      const inside = overlay.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    overlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-cel-close]')) close();
    });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('hashchange', close);
    document.body.classList.add('no-scroll');
    document.body.append(overlay);
    overlay.querySelector('[data-cel-close]').focus();
  });
}
