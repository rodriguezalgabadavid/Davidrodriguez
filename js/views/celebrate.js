import { activityTitle, formatScore } from '../activities.js';
import { challengeProgress, completedChallenges, currentChallenges } from '../challenges.js';
import { icon } from '../icons.js';
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
// Confeti con los colores de la marca: amarillo bola, azul de pista y blanco de las líneas.
const CONFETTI_COLORS = ['--accent', '--primary', '--court-line', '--accent', '--court', '--court-line'];
const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function headline(activity) {
  if (activity?.type === 'partido') {
    if (activity.won === true) return { icon: 'trophy', title: '¡Victoria publicada!', text: '' };
    if (activity.won === false) return { icon: 'ball', title: '¡Partido publicado!', text: 'Hoy no salió, pero ya suma. ¡A por la revancha!' };
    return { icon: 'ball', title: '¡Partido publicado!', text: '' };
  }
  if (activity?.type === 'clase') return { icon: 'target', title: '¡Clase completada!', text: '' };
  return { icon: 'bolt', title: '¡Entreno completado!', text: '' };
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
    return { unlocked: [], progressed: [], streak: after?.streak ?? null, streakGrew: false, streakDelta: 0 };
  }
  const prev = new Map((before.challenges ?? []).map((c) => [c.instanceId, c]));
  const progressed = (after.challenges ?? [])
    .map((c) => ({ ...c, before: prev.get(c.instanceId) }))
    .filter((c) => c.before && !c.before.done && c.value > c.before.value)
    .map((c) => ({ ...c, completedNow: c.done && !c.before.done }));
  const streakDelta = after.streak && before.streak ? Math.max(0, after.streak.weeks - before.streak.weeks) : 0;
  return {
    unlocked: newlyUnlocked(before.achievements, after.achievements),
    progressed,
    streak: after.streak ?? null,
    streakGrew: streakDelta > 0,
    streakDelta,
  };
}

function confetti() {
  const pieces = Array.from({ length: 30 }, (_, i) => {
    const x = (i * 37 + 11) % 100;
    const delay = ((i * 7) % 10) / 10;
    const dur = 1.8 + ((i * 13) % 10) / 10;
    const rot = (i * 53) % 360;
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    return `<i style="--x:${x}%;--d:${delay}s;--t:${dur}s;--r:${rot}deg;--c:var(${color})"></i>`;
  });
  return `<div class="cel-confetti" aria-hidden="true">${pieces.join('')}</div>`;
}

// Logros nuevos: medallas en amarillo bola (el emoji es el "arte" del logro).
function achievementsHtml(list) {
  if (!list.length) return '';
  return `
    <section class="cel-section">
      <h3 class="label cel-label">${list.length > 1 ? `${list.length} logros desbloqueados` : 'Logro desbloqueado'}</h3>
      <ul class="cel-medals">
        ${list.map((a, i) => `
          <li class="cel-medal cel-pop" style="--i:${i}">
            <span class="cel-medal-icon" aria-hidden="true">${escapeHtml(a.icon)}</span>
            <strong class="cel-medal-name">${escapeHtml(a.label)}</strong>
            <span class="cel-medal-text">${escapeHtml(a.description)}</span>
          </li>`).join('')}
      </ul>
    </section>`;
}

function challengeRow(c, i) {
  return `
    <li class="cel-row cel-pop${c.completedNow ? ' cel-done' : ''}" style="--i:${i}">
      <span class="cel-row-icon" aria-hidden="true">${escapeHtml(c.icon)}</span>
      <span class="cel-row-body">
        <span class="cel-row-title">
          <strong>${escapeHtml(c.title)}</strong>
          ${c.completedNow ? `<span class="result win cel-done-tag">${icon('check', { size: 14 })}Completado</span>` : ''}
        </span>
        <span class="cel-progress-text">
          ${escapeHtml(numFmt.format(c.before.value))} → <strong>${escapeHtml(numFmt.format(c.value))}</strong> de ${escapeHtml(numFmt.format(c.target))}
        </span>
        <span class="progress cel-bar" aria-hidden="true">
          <span style="--from:${pct(c.before.value, c.target)}%;--to:${pct(c.value, c.target)}%"></span>
        </span>
      </span>
    </li>`;
}

function streakRow(streak, delta, index) {
  if (!streak?.weeks) return '';
  const weeks = streak.weeks;
  const label = weeks === 1 ? '1 semana en racha' : `${weeks} semanas seguidas`;
  let text;
  if (!streak.activeThisWeek) text = 'Publica algo esta semana para que no se corte.';
  else if (delta && weeks === 1) text = '¡Racha iniciada! Haz algo cada semana para alargarla.';
  else if (delta) text = 'Una actividad por semana y la racha sigue creciendo.';
  else text = 'Esta semana ya cuenta para tu racha.';
  return `
    <li class="cel-row${delta ? ' cel-pop' : ''}" style="--i:${index}">
      <span class="cel-row-icon cel-flame">${icon('flame', { size: 24 })}</span>
      <span class="cel-row-body">
        <span class="cel-row-title">
          <strong>${escapeHtml(label)}</strong>
          ${delta ? `<span class="cel-plus">+${delta}<span class="sr-only"> ${delta === 1 ? 'semana' : 'semanas'}</span></span>` : ''}
        </span>
        <span class="cel-row-text">${escapeHtml(text)}</span>
      </span>
    </li>`;
}

// Retos que han avanzado y la racha: filas al estilo Strava con barra de progreso.
function progressHtml(diff) {
  const offset = diff.unlocked.length;
  const rows = [
    ...diff.progressed.map((c, i) => challengeRow(c, offset + i)),
    streakRow(diff.streak, diff.streakDelta, offset + diff.progressed.length),
  ].join('');
  if (!rows.trim()) return '';
  return `
    <section class="cel-section">
      <h3 class="label cel-label">Tu progreso</h3>
      <ul class="card cel-rows">${rows}</ul>
    </section>`;
}

function celebrationHtml(ctx, { activity, before, after }) {
  const head = headline(activity);
  const sub = subtitle(activity);
  const diff = diffSnapshots(before, after);
  const nothingNew = !diff.unlocked.length && !diff.progressed.length && !diff.streakGrew;
  const demo = ctx?.backend?.mode === 'demo';
  const art = activity?.photoUrl
    ? `<img class="cel-photo" src="${escapeHtml(activity.photoUrl)}" alt="Foto de tu actividad" />`
    : `<span class="cel-icon">${icon(head.icon, { size: 36 })}</span>`;

  return `
    ${confetti()}
    <div class="cel-box" role="dialog" aria-modal="true" aria-labelledby="cel-title" aria-describedby="cel-sub">
      <header class="cel-head">
        <div class="cel-stage">
          <svg class="cel-court" viewBox="0 0 200 100" aria-hidden="true" focusable="false">
            <rect x="6" y="6" width="188" height="88" rx="2"/>
            <path d="M37 6v88M163 6v88M37 50h126"/>
            <path class="cel-court-net" d="M100 2v96"/>
          </svg>
          <span class="cel-ball" aria-hidden="true"></span>
          ${art}
        </div>
        <div class="cel-head-inner">
          <p class="cel-kicker">${icon('check', { size: 16 })}Publicado en tu muro</p>
          <h2 id="cel-title" class="cel-title">${escapeHtml(head.title)}</h2>
          <p id="cel-sub" class="cel-sub">${escapeHtml(sub)}</p>
          ${head.text ? `<p class="cel-note">${escapeHtml(head.text)}</p>` : ''}
        </div>
      </header>
      <div class="cel-body">
        ${achievementsHtml(diff.unlocked)}
        ${progressHtml(diff)}
        ${nothingNew ? '<p class="cel-cheer">Ya está en tu muro y en tu perfil. ¡Cada actividad cuenta!</p>' : ''}
        <p class="cel-hint">
          <span class="cel-hint-icon">${icon('racket', { size: 20 })}</span>
          <span>Tus amigos ya pueden darte ¡Vamos!${demo ? ' <span class="muted">En la demo reaccionan jugadores de ejemplo.</span>' : ''}</span>
        </p>
      </div>
      <footer class="cel-foot">
        <button type="button" class="btn primary big cel-close" data-cel-close>¡Seguir!</button>
      </footer>
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
