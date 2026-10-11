import { CATEGORIES, EQUIPMENT, EXERCISES, FOCUSES, LEVELS, getExercise } from './data.js';
import { buildTimeline, timelineDuration } from './generator.js';
import {
  ACTIVITY_TYPES, MATCH_KINDS, POSITIONS, activityTitle, formatScore, knownNames, matchOutcome, sessionLoad, sortByDateDesc,
} from './activities.js';
import { achievements, loadRatio, matchStats, weekActivity, weekSummary, weeklyLoad } from './stats.js';
import { escapeHtml, formatDuration, formatHours, formatWhen, toLocalInput } from './ui.js';

// Escala de esfuerzo percibido (Borg CR-10) que se muestra al registrar.
const RPE_LABELS = {
  1: 'Muy suave', 2: 'Suave', 3: 'Moderado', 4: 'Algo duro', 5: 'Duro',
  6: 'Duro', 7: 'Muy duro', 8: 'Muy duro', 9: 'Extremo', 10: 'Máximo',
};

const typeVar = (type) => `var(--t-${type})`;

function typeBadge(type) {
  return `<span class="type-badge" style="--type:${typeVar(type)}" aria-hidden="true">${ACTIVITY_TYPES[type].icon}</span>`;
}

// ---------- Componentes ----------

function scoreboard(sets) {
  const { won } = matchOutcome(sets);
  const row = (label, side, isWinner) => `
    <tr class="${isWinner ? 'winner' : ''}">
      <th scope="row">${label}</th>
      ${sets.map(([a, b]) => {
        const mine = side === 0 ? a : b;
        const theirs = side === 0 ? b : a;
        return `<td class="${mine > theirs ? 'set-won' : ''}">${mine}</td>`;
      }).join('')}
    </tr>`;
  return `
    <table class="scoreboard" aria-label="Resultado ${formatScore(sets)}">
      <tbody>${row('Nosotros', 0, won === true)}${row('Rivales', 1, won === false)}</tbody>
    </table>`;
}

function resultPill(won) {
  if (won === null) return '<span class="result draw">Empate</span>';
  return won ? '<span class="result win">Victoria</span>' : '<span class="result loss">Derrota</span>';
}

function matchPeople(a) {
  const parts = [];
  if (a.partner) parts.push(`con <strong>${escapeHtml(a.partner)}</strong>`);
  if (a.rivals?.length) parts.push(`vs ${a.rivals.map((r) => `<strong>${escapeHtml(r)}</strong>`).join(' y ')}`);
  return parts.join(' ');
}

function metrics(a) {
  return `
    <dl class="metrics">
      <div><dt>Tiempo</dt><dd>${formatDuration(a.seconds)}</dd></div>
      <div><dt>Esfuerzo</dt><dd>${a.rpe}/10</dd></div>
      <div><dt>Carga</dt><dd>${sessionLoad(a)}</dd></div>
    </dl>`;
}

function activityCard(a, ctx) {
  const isMatch = a.type === 'partido';
  const outcome = isMatch ? matchOutcome(a.sets) : null;
  const where = [isMatch ? MATCH_KINDS[a.matchKind] : ACTIVITY_TYPES[a.type].label, a.club].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <article class="activity card" style="--type:${typeVar(a.type)}">
      <button class="activity-open" data-action="open-activity" data-id="${a.id}" aria-label="Ver ${escapeHtml(activityTitle(a))}"></button>
      <header class="activity-head">
        ${typeBadge(a.type)}
        <div class="activity-who">
          <strong>${escapeHtml(ctx.state.settings.name || 'Tú')}</strong>
          <span class="muted">${formatWhen(a.date, ctx.now)} · ${where}</span>
        </div>
        ${a.demo ? '<span class="pill">Ejemplo</span>' : ''}
      </header>
      <h3 class="activity-title">${escapeHtml(activityTitle(a))}</h3>
      ${isMatch ? `<div class="activity-match">${resultPill(outcome.won)}${scoreboard(a.sets)}</div>` : ''}
      ${isMatch && matchPeople(a) ? `<p class="people">${matchPeople(a)}</p>` : ''}
      ${metrics(a)}
      ${a.notes ? `<p class="notes">${escapeHtml(a.notes)}</p>` : ''}
    </article>`;
}

function weekBars(activities, now) {
  const week = weekActivity(activities, now);
  const max = Math.max(60, ...week.map((d) => d.minutes));
  return `
    <div class="week" role="img" aria-label="Minutos por día esta semana">
      ${week.map((d) => `
        <div class="week-day ${d.isToday ? 'today' : ''}">
          <div class="bar-track">
            ${Object.keys(ACTIVITY_TYPES).map((t) => d.byType[t]
              ? `<div class="bar" style="height:${(d.byType[t] / max) * 100}%;--type:${typeVar(t)}" title="${ACTIVITY_TYPES[t].label}: ${d.byType[t]} min"></div>`
              : '').join('')}
          </div>
          <span>${d.label}</span>
        </div>`).join('')}
    </div>
    <div class="legend">
      ${Object.entries(ACTIVITY_TYPES).map(([t, def]) => `<span><i style="--type:${typeVar(t)}"></i>${def.label}</span>`).join('')}
    </div>`;
}

function delta(current, previous) {
  if (!previous) return '';
  const pct = Math.round(((current - previous) / previous) * 100);
  if (!pct) return '<span class="delta">= semana pasada</span>';
  return `<span class="delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs semana pasada</span>`;
}

// ---------- Inicio (muro) ----------

export function viewInicio(ctx) {
  const { state, now } = ctx;
  const acts = sortByDateDesc(state.activities);
  const hasDemo = acts.some((a) => a.demo);

  if (!acts.length) {
    return `
      <section class="hero card">
        <h1>Tu pádel, en un solo sitio</h1>
        <p>Registra tus partidos, sigue tus resultados con cada pareja y prepárate físicamente para llegar a todas.</p>
        <div class="hero-actions">
          <button class="btn primary big" data-route="registrar">Registrar un partido</button>
          <button class="btn ghost big" data-route="entrenar">Hacer una sesión de físico</button>
        </div>
      </section>
      <section class="card empty">
        <h2>Tu muro está vacío</h2>
        <p class="muted">Aquí aparecerán tus partidos, clases y sesiones de físico con su resultado, tiempo y carga. ¿Quieres ver cómo queda antes de empezar?</p>
        <button class="btn" data-action="load-demo">Ver con datos de ejemplo</button>
      </section>`;
  }

  const { current, previous } = weekSummary(acts, now);
  const goal = state.settings.weeklyGoal;
  const pct = Math.min(100, Math.round((current.count / goal) * 100));

  return `
    ${hasDemo ? `
      <div class="banner">
        <span>Estás viendo datos de ejemplo.</span>
        <button class="link" data-action="clear-demo">Quitar ejemplos</button>
      </div>` : ''}

    <section class="card summary">
      <div class="row-between">
        <h2>Esta semana</h2>
        ${delta(current.load, previous.load)}
      </div>
      <div class="summary-grid">
        <div><span class="big-num">${current.count}</span><span class="label">actividades</span></div>
        <div><span class="big-num">${formatHours(current.minutes)}</span><span class="label">tiempo</span></div>
        <div><span class="big-num">${current.load}</span><span class="label">carga</span></div>
        <div><span class="big-num">${current.wins}–${current.losses}</span><span class="label">partidos G–P</span></div>
      </div>
      <div class="goal">
        <div class="row-between"><span class="label">Objetivo: ${goal} actividades</span><span class="label">${pct}%</span></div>
        <div class="progress"><div style="width:${pct}%"></div></div>
      </div>
      ${weekBars(acts, now)}
    </section>

    <div class="quick">
      <button class="btn primary" data-route="registrar">＋ Registrar actividad</button>
      <button class="btn" data-route="entrenar">⚡ Entrenar</button>
    </div>

    <section class="feed" aria-label="Actividades">
      ${acts.map((a) => activityCard(a, ctx)).join('')}
    </section>`;
}

// ---------- Registrar / editar ----------

export function viewRegistrar(ctx) {
  const { state, now } = ctx;
  const editing = state.activities.find((a) => a.id === state.editId);
  const a = editing ?? { type: state.draftType || 'partido', date: now.toISOString(), rpe: 6, sets: [], rivals: [], matchKind: 'amistoso', position: state.settings.position };
  const minutes = editing ? Math.round(a.seconds / 60) : ACTIVITY_TYPES[a.type].defaultMinutes;
  const { people, clubs } = knownNames(state.activities);
  const sets = [0, 1, 2].map((i) => a.sets?.[i] ?? ['', '']);

  const radios = (name, options, selected) => Object.entries(options)
    .map(([k, label]) => `
      <label class="chip-radio">
        <input type="radio" name="${name}" value="${k}" ${selected === k ? 'checked' : ''} />
        <span>${label}</span>
      </label>`).join('');

  return `
    <form id="activity-form" class="card form" novalidate>
      <div class="row-between">
        <h2>${editing ? 'Editar actividad' : 'Registrar actividad'}</h2>
        ${editing ? '<button type="button" class="link" data-action="cancel-edit">Cancelar</button>' : ''}
      </div>

      <div class="field">
        <span class="field-label">Tipo</span>
        <div class="segmented">
          ${Object.entries(ACTIVITY_TYPES).map(([k, t]) => `
            <label><input type="radio" name="type" value="${k}" ${a.type === k ? 'checked' : ''} /><span>${t.icon} ${t.label}</span></label>`).join('')}
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="f-date">Fecha y hora</label>
          <input class="input" id="f-date" name="date" type="datetime-local" value="${toLocalInput(a.date)}" required />
        </div>
        <div class="field">
          <label class="field-label" for="f-minutes">Duración (min)</label>
          <input class="input" id="f-minutes" name="minutes" type="number" inputmode="numeric" min="1" max="600" value="${minutes}" required />
        </div>
      </div>

      <fieldset class="match-fields" data-section="partido" ${a.type === 'partido' ? '' : 'hidden'}>
        <div class="field">
          <span class="field-label">Resultado</span>
          <div class="sets-input">
            <span></span><span class="label">Set 1</span><span class="label">Set 2</span><span class="label">Set 3</span>
            <span class="label">Nosotros</span>
            ${sets.map((s, i) => `<input class="input score-input" id="f-set${i}-a" name="set${i}a" type="number" inputmode="numeric" min="0" max="99" value="${s[0]}" aria-label="Set ${i + 1}, nuestros juegos" />`).join('')}
            <span class="label">Rivales</span>
            ${sets.map((s, i) => `<input class="input score-input" id="f-set${i}-b" name="set${i}b" type="number" inputmode="numeric" min="0" max="99" value="${s[1]}" aria-label="Set ${i + 1}, juegos rivales" />`).join('')}
          </div>
          <p class="hint">Deja el tercer set vacío si no se jugó. Un súper tie-break se apunta como set (p. ej. 10-8).</p>
        </div>

        <div class="field">
          <span class="field-label">Tipo de partido</span>
          <div class="chips">${radios('matchKind', MATCH_KINDS, a.matchKind)}</div>
        </div>

        <div class="field">
          <span class="field-label">Tu posición</span>
          <div class="chips">${radios('position', POSITIONS, a.position)}</div>
        </div>

        <div class="field">
          <label class="field-label" for="f-partner">Compañero/a</label>
          <input class="input" id="f-partner" name="partner" list="people" autocomplete="off" placeholder="Nombre" value="${escapeHtml(a.partner ?? '')}" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label" for="f-rival1">Rival 1</label>
            <input class="input" id="f-rival1" name="rival1" list="people" autocomplete="off" value="${escapeHtml(a.rivals?.[0] ?? '')}" />
          </div>
          <div class="field">
            <label class="field-label" for="f-rival2">Rival 2</label>
            <input class="input" id="f-rival2" name="rival2" list="people" autocomplete="off" value="${escapeHtml(a.rivals?.[1] ?? '')}" />
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="f-club">Club o pista</label>
          <input class="input" id="f-club" name="club" list="clubs" autocomplete="off" value="${escapeHtml(a.club ?? '')}" />
        </div>
        <datalist id="people">${people.map((p) => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
        <datalist id="clubs">${clubs.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </fieldset>

      <div class="field">
        <label class="field-label" for="f-title">Título <span class="muted">(opcional)</span></label>
        <input class="input" id="f-title" name="title" placeholder="${a.type === 'partido' ? 'Se rellena con el resultado' : 'Ej.: Clase de bandeja'}" value="${escapeHtml(a.title ?? '')}" />
      </div>

      <div class="field">
        <label class="field-label" for="f-rpe">Esfuerzo percibido: <strong id="rpe-out">${a.rpe}/10 · ${RPE_LABELS[a.rpe]}</strong></label>
        <input id="f-rpe" name="rpe" type="range" min="1" max="10" value="${a.rpe}" />
        <p class="hint">Junto con la duración calcula tu carga: minutos × esfuerzo.</p>
      </div>

      <div class="field">
        <label class="field-label" for="f-notes">Sensaciones</label>
        <textarea class="input" id="f-notes" name="notes" rows="3" placeholder="Qué funcionó, qué mejorar, molestias…">${escapeHtml(a.notes ?? '')}</textarea>
      </div>

      <p class="form-error" id="form-error" role="alert" hidden></p>
      <button class="btn primary big" type="submit">${editing ? 'Guardar cambios' : 'Guardar actividad'}</button>
    </form>`;
}

export function rpeLabel(value) {
  return `${value}/10 · ${RPE_LABELS[value]}`;
}

// ---------- Detalle ----------

export function viewActividad(ctx) {
  const a = ctx.state.activities.find((x) => x.id === ctx.state.detailId);
  if (!a) return '<p class="muted center">Esta actividad ya no existe.</p>';
  const isMatch = a.type === 'partido';
  const outcome = isMatch ? matchOutcome(a.sets) : null;
  const exercises = a.type === 'entreno' && a.focus ? FOCUSES[a.focus]?.label : null;

  return `
    <button class="link back" data-route="inicio">← Volver al muro</button>
    <article class="card detail" style="--type:${typeVar(a.type)}">
      <header class="activity-head">
        ${typeBadge(a.type)}
        <div class="activity-who">
          <strong>${ACTIVITY_TYPES[a.type].label}${isMatch ? ` · ${MATCH_KINDS[a.matchKind]}` : ''}</strong>
          <span class="muted">${formatWhen(a.date, ctx.now)}${a.club ? ` · ${escapeHtml(a.club)}` : ''}</span>
        </div>
      </header>
      <h1>${escapeHtml(activityTitle(a))}</h1>
      ${isMatch ? `
        <div class="activity-match">${resultPill(outcome.won)}${scoreboard(a.sets)}</div>
        <p class="muted">Sets ${outcome.setsFor}–${outcome.setsAgainst} · Juegos ${outcome.gamesFor}–${outcome.gamesAgainst}${a.position ? ` · Jugaste de ${POSITIONS[a.position].toLowerCase()}` : ''}</p>
        ${matchPeople(a) ? `<p class="people">${matchPeople(a)}</p>` : ''}` : ''}
      ${exercises ? `<p class="muted">Sesión generada: ${escapeHtml(exercises)} · ${LEVELS[a.level]?.label ?? ''}</p>` : ''}
      ${metrics(a)}
      ${a.notes ? `<h3>Sensaciones</h3><p class="notes full">${escapeHtml(a.notes)}</p>` : ''}
      <div class="actions">
        <button class="btn" data-action="edit-activity" data-id="${a.id}">Editar</button>
        <button class="btn danger" data-action="delete-activity" data-id="${a.id}">Eliminar</button>
      </div>
    </article>`;
}

// ---------- Progreso ----------

function recordTable(rows, { title, empty, kind }) {
  if (!rows.length) return `<div class="card"><h2>${title}</h2><p class="muted">${empty}</p></div>`;
  return `
    <div class="card">
      <h2>${title}</h2>
      <div class="table-wrap">
        <table class="records">
          <thead><tr><th scope="col">Nombre</th><th scope="col">PJ</th><th scope="col">G–P</th><th scope="col">% vict.</th></tr></thead>
          <tbody>
            ${rows.slice(0, 6).map((r) => {
              const decided = r.won + r.lost;
              const pct = decided ? Math.round((r.won / decided) * 100) : null;
              return `<tr>
                <th scope="row">${escapeHtml(r.name)}</th>
                <td>${r.played}</td>
                <td>${r.won}–${r.lost}</td>
                <td><span class="pct ${pct === null ? '' : pct >= 50 ? 'good' : 'bad'}">${pct === null ? '–' : `${pct}%`}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="hint">${kind === 'partner' ? 'Tu balance jugando con cada pareja.' : 'Tu balance contra cada rival.'}</p>
    </div>`;
}

const ZONES = {
  baja: { label: 'Por debajo de tu media', tone: 'neutral', tip: 'Buen momento para subir un poco el volumen.' },
  optima: { label: 'Zona óptima', tone: 'good', tip: 'Tu carga está en línea con lo que tu cuerpo está acostumbrado.' },
  alta: { label: 'Carga alta', tone: 'warn', tip: 'Vigila el descanso y las molestias estos días.' },
  riesgo: { label: 'Riesgo de sobrecarga', tone: 'bad', tip: 'Has subido mucho de golpe. Mete un día suave o de movilidad.' },
};

function loadChart(activities, now) {
  const weeks = weeklyLoad(activities, now);
  const max = Math.max(...weeks.map((w) => w.load), 1);
  return `
    <div class="load-chart" role="img" aria-label="Carga semanal de las últimas 8 semanas">
      ${weeks.map((w, i) => `
        <div class="load-col ${i === weeks.length - 1 ? 'current' : ''}">
          <span class="load-val">${w.load || ''}</span>
          <div class="load-track"><div class="load-bar" style="height:${(w.load / max) * 100}%"></div></div>
          <span class="load-label">${w.label}</span>
        </div>`).join('')}
    </div>`;
}

export function viewProgreso(ctx) {
  const { state, now } = ctx;
  const acts = state.activities;
  const m = matchStats(acts);
  const ratio = loadRatio(acts, now);
  const zone = ratio.zone && ZONES[ratio.zone];
  const badges = achievements(acts);
  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const posRow = (key) => {
    const p = m.positions[key];
    return p.played ? `<div><span class="label">${POSITIONS[key]}</span><strong>${p.won}/${p.played}</strong></div>` : '';
  };

  return `
    <section class="card">
      <h2>Partidos</h2>
      ${m.played ? `
        <div class="summary-grid">
          <div><span class="big-num">${m.played}</span><span class="label">jugados</span></div>
          <div><span class="big-num">${m.winRate ?? '–'}${m.winRate === null ? '' : '%'}</span><span class="label">victorias</span></div>
          <div><span class="big-num">${m.currentWinStreak}</span><span class="label">racha actual</span></div>
          <div><span class="big-num">${m.bestWinStreak}</span><span class="label">mejor racha</span></div>
        </div>
        <div class="form-strip">
          <span class="label">Últimos partidos</span>
          <div class="dots">${m.lastResults.map((w) => `<span class="dot-result ${w === null ? 'draw' : w ? 'win' : 'loss'}">${w === null ? 'E' : w ? 'G' : 'P'}</span>`).join('')}</div>
        </div>
        <div class="split">
          <div><span class="label">Sets</span><strong>${m.setsFor}–${m.setsAgainst}</strong></div>
          <div><span class="label">Juegos</span><strong>${m.gamesFor}–${m.gamesAgainst}</strong></div>
          ${posRow('drive')}${posRow('reves')}
        </div>` : '<p class="muted">Cuando registres partidos verás aquí tu porcentaje de victorias, rachas y balance por posición.</p>'}
    </section>

    ${recordTable(m.partners, { title: 'Compañeros', empty: 'Apunta con quién juegas para ver con qué pareja ganas más.', kind: 'partner' })}
    ${recordTable(m.rivals, { title: 'Rivales', empty: 'Apunta tus rivales para ver tu balance contra cada uno.', kind: 'rival' })}

    <section class="card">
      <div class="row-between">
        <h2>Carga de entrenamiento</h2>
        <span class="muted">min × esfuerzo</span>
      </div>
      ${loadChart(acts, now)}
      ${zone ? `
        <div class="zone ${zone.tone}">
          <div class="row-between"><strong>${zone.label}</strong><span class="ratio">${ratio.ratio.toFixed(2)}</span></div>
          <p>Últimos 7 días: ${ratio.acute} · media semanal del último mes: ${ratio.chronic}. ${zone.tip}</p>
        </div>` : '<p class="hint">Con 3 semanas de registros compararemos tu última semana con tu media del mes para avisarte si te estás sobrecargando.</p>'}
    </section>

    <section class="card">
      <div class="row-between"><h2>Logros</h2><span class="muted">${unlockedCount}/${badges.length}</span></div>
      <div class="badges">
        ${badges.map((b) => `
          <div class="badge ${b.unlocked ? 'on' : ''}" title="${escapeHtml(b.description)}">
            <span class="badge-icon" aria-hidden="true">${b.icon}</span>
            <strong>${b.label}</strong>
            <span>${b.description}</span>
          </div>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2>Perfil y ajustes</h2>
      <div class="field">
        <label class="field-label" for="s-name">Tu nombre</label>
        <input class="input" id="s-name" data-input="name" value="${escapeHtml(state.settings.name ?? '')}" placeholder="Cómo apareces en el muro" />
      </div>
      <div class="field">
        <span class="field-label">Posición habitual</span>
        <div class="segmented">
          ${Object.entries(POSITIONS).map(([k, l]) => `<button class="${state.settings.position === k ? 'on' : ''}" data-set="position" data-value="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="s-goal">Objetivo semanal: <strong id="goal-out">${state.settings.weeklyGoal}</strong> actividades</label>
        <input id="s-goal" type="range" min="1" max="10" value="${state.settings.weeklyGoal}" data-input="weekly-goal" />
      </div>
      <label class="switch">
        <input type="checkbox" id="s-sound" ${state.settings.sound ? 'checked' : ''} data-input="sound" />
        <span>Avisos sonoros y vibración en el temporizador</span>
      </label>
    </section>

    <section class="card">
      <h2>Tus datos</h2>
      <p class="muted">Todo se guarda solo en este dispositivo. Haz una copia de seguridad para no perder tu historial o pasarlo a otro móvil.</p>
      <div class="actions wrap">
        <button class="btn" data-action="export">Descargar copia</button>
        <label class="btn" for="import-file">Restaurar copia</label>
        <input id="import-file" type="file" accept="application/json,.json" hidden data-input="import" />
      </div>
      ${acts.length ? '<button class="btn danger" data-action="clear-all">Borrar todos mis datos</button>' : ''}
    </section>`;
}

// ---------- Entrenar ----------

function exerciseCard(ex, { compact = false } = {}) {
  const c = CATEGORIES[ex.category];
  const extras = [
    ex.sides ? '<span class="pill">Ambos lados</span>' : '',
    ...ex.equipment.map((e) => `<span class="pill">${escapeHtml(e)}</span>`),
    `<span class="pill">${LEVELS[ex.level].label}</span>`,
  ].join('');
  return `
    <details class="exercise">
      <summary>
        <span class="dot" style="--tag:${c.color}"></span>
        <span class="exercise-name">${escapeHtml(ex.name)}</span>
      </summary>
      <div class="exercise-body">
        ${compact ? '' : `<span class="tag" style="--tag:${c.color}">${c.label}</span>`}
        <p>${escapeHtml(ex.description)}</p>
        <p class="why"><strong>En pista:</strong> ${escapeHtml(ex.padel)}</p>
        <div class="pills">${extras}</div>
      </div>
    </details>`;
}

export function viewEntrenar(ctx) {
  const s = ctx.state.settings;
  const session = ctx.state.session;
  const form = `
    <section class="card">
      <h2>Preparación física</h2>
      <p class="muted">Sesiones específicas para pádel. Se guardan en tu muro al terminarlas.</p>
      <div class="field">
        <span class="field-label">Objetivo</span>
        <div class="chips">
          ${Object.entries(FOCUSES).map(([k, f]) => `<button class="chip ${s.focus === k ? 'on' : ''}" data-set="focus" data-value="${k}">${f.label}</button>`).join('')}
        </div>
        <p class="hint">${FOCUSES[s.focus].description}</p>
      </div>
      <div class="field">
        <span class="field-label">Nivel</span>
        <div class="segmented">
          ${Object.entries(LEVELS).map(([k, l]) => `<button class="${String(s.level) === k ? 'on' : ''}" data-set="level" data-value="${k}">${l.label}</button>`).join('')}
        </div>
        <p class="hint">${LEVELS[s.level].work}s de trabajo / ${LEVELS[s.level].rest}s de descanso</p>
      </div>
      <div class="field">
        <span class="field-label">Duración</span>
        <div class="segmented">
          ${[15, 20, 30, 45, 60].map((m) => `<button class="${s.minutes === m ? 'on' : ''}" data-set="minutes" data-value="${m}">${m}'</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <span class="field-label">Material disponible</span>
        <div class="chips">
          ${EQUIPMENT.map((e) => `<button class="chip ${s.equipment.includes(e) ? 'on' : ''}" data-action="toggle-equipment" data-value="${e}">${e}</button>`).join('')}
        </div>
        <p class="hint">Sin material también puedes entrenar: elegiremos ejercicios con tu peso corporal.</p>
      </div>
      <button class="btn primary big" data-action="generate">${session ? 'Generar otra sesión' : 'Generar sesión'}</button>
    </section>`;

  if (!session) return form;

  const steps = buildTimeline(session);
  return `${form}
    <section class="card session" id="session-preview">
      <h2>${escapeHtml(session.title)}</h2>
      <p class="muted">${LEVELS[session.level].label} · ~${Math.round(timelineDuration(steps) / 60)} min · ${session.rounds} ronda${session.rounds === 1 ? '' : 's'} en el bloque principal</p>
      ${session.blocks.map((b) => `
        <div class="block">
          <h3>${b.name}${b.key === 'main' ? ` <span class="muted">× ${session.rounds} · ${session.work}s/${session.rest}s</span>` : ''}</h3>
          ${b.exercises.map((id) => exerciseCard(getExercise(id), { compact: true })).join('')}
        </div>`).join('')}
      <div class="actions">
        <button class="btn" data-action="generate">Otra variante</button>
        <button class="btn primary" data-action="start">▶ Empezar</button>
      </div>
    </section>`;
}

// ---------- Ejercicios ----------

export function viewEjercicios(ctx) {
  const { category, query } = ctx.state.library;
  const q = query.trim().toLowerCase();
  const list = EXERCISES.filter(
    (e) => (category === 'all' || e.category === category) && (!q || `${e.name} ${e.description} ${e.padel}`.toLowerCase().includes(q)),
  );
  return `
    <section class="card">
      <h2>Biblioteca de ejercicios</h2>
      <input class="input search" id="library-query" type="search" placeholder="Buscar: hombro, salto, rotación…" value="${escapeHtml(query)}" data-input="library-query" />
      <div class="chips scroll">
        <button class="chip ${category === 'all' ? 'on' : ''}" data-action="library-category" data-value="all">Todos</button>
        ${Object.entries(CATEGORIES).map(([k, c]) => `<button class="chip ${category === k ? 'on' : ''}" data-action="library-category" data-value="${k}">${c.label}</button>`).join('')}
      </div>
    </section>
    <section class="library">
      ${list.length ? list.map((e) => exerciseCard(e)).join('') : '<p class="muted center">No hay ejercicios que coincidan.</p>'}
    </section>`;
}
