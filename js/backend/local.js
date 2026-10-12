// Backend "demo": todo se guarda en este dispositivo (localStorage, clave 'padelfit:v3'), con una comunidad
// de ejemplo, interacciones simuladas ("¡Vamos!", comentarios y seguidores que llegan unos segundos después)
// y un pago Premium simulado. Cumple la interfaz de docs/ARCHITECTURE.md.

import { fromLegacy, normalizeActivityInput, POSITIONS, sanitizeSets } from '../activities.js';
import { blobToDataUrl } from '../photos.js';
import { demoPost, randomId, reactionComment, seedCommunity } from './demo-data.js';

const STORAGE_KEY = 'padelfit:v3';
const LEGACY_KEYS = ['padelfit:activities', 'padelfit:history']; // v2 y v1
const QUOTA_MESSAGE = 'No queda espacio en este dispositivo para más fotos. Borra alguna actividad con foto.';

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
const TICK_MS = 3 * SECOND;
const COMMUNITY_EVERY_MS = 20 * HOUR;
const PREMIUM_PERIOD_MS = 30 * DAY;

const MSG = {
  noProfile: 'Crea tu perfil para empezar.',
  demoSignIn: 'En modo demo no necesitas cuenta: crea tu perfil y empieza.',
  noActivity: 'Esta actividad ya no existe.',
  noPlayer: 'Este jugador ya no existe.',
  selfFollow: 'No puedes seguirte a ti mismo.',
};

// ---------- Utilidades ----------

const nowIso = () => new Date().toISOString();
const time = (value) => new Date(value).getTime();
function iso(value) {
  if (value == null || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
const cleanText = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const fold = (s) => cleanText(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function byDateDesc(a, b) {
  return time(b.date) - time(a.date) || time(b.createdAt) - time(a.createdAt);
}

function isQuotaError(error) {
  return Boolean(error) && (
    error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014
  );
}

function getStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    storage.getItem(STORAGE_KEY); // en algunos modos privados el acceso lanza
    return storage;
  } catch {
    return null;
  }
}

// Valida y recorta los campos editables del perfil (mismos límites que el backend live).
function profilePatch(patch = {}, { requireName = false } = {}) {
  const out = {};
  if (requireName || 'name' in patch) {
    const name = cleanText(patch.name).slice(0, 60);
    if (!name) throw new Error('Escribe tu nombre para que tus amigos te encuentren.');
    out.name = name;
  }
  if ('level' in patch) out.level = [1, 2, 3].includes(Number(patch.level)) ? Number(patch.level) : 2;
  if ('position' in patch) out.position = POSITIONS[patch.position] ? patch.position : null;
  if ('club' in patch) out.club = cleanText(patch.club).slice(0, 80);
  if ('bio' in patch) out.bio = String(patch.bio ?? '').trim().slice(0, 500);
  return out;
}

// ActivityInput (ya normalizado) → registro guardado.
function activityRecord(input, { id, userId, photoUrl = null, createdAt }) {
  const plan = input.plan?.planId ? { planId: String(input.plan.planId), sessionKey: String(input.plan.sessionKey ?? '') } : null;
  return {
    id,
    userId,
    type: input.type,
    date: iso(input.date) ?? createdAt,
    seconds: Math.max(0, Math.round(Number(input.seconds) || 0)),
    rpe: input.rpe ?? null,
    won: input.won ?? null,
    sets: Array.isArray(input.sets) ? input.sets.map(([a, b]) => [Number(a), Number(b)]) : [],
    matchKind: input.matchKind ?? null,
    partner: input.partner ?? '',
    rivals: Array.isArray(input.rivals) ? [...input.rivals] : [],
    club: input.club ?? '',
    title: input.title ?? '',
    text: input.text ?? '',
    photoUrl,
    plan,
    focus: input.focus ?? null,
    createdAt,
  };
}

const emptyPlanState = () => ({ planId: null, startedAt: null, completed: {}, finished: [] });

function freshState(now = new Date()) {
  return {
    me: null,
    ...seedCommunity(now),
    notifications: [],
    challenges: [],
    plan: emptyPlanState(),
    subscription: { active: false, renewsAt: null },
    premiumAnswers: null,
    pending: [],
    seededAt: iso(now),
    lastDemoPostAt: iso(now),
  };
}

// Completa lo que falte en un estado guardado (versiones anteriores o datos a medias).
function withDefaults(stored) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const plan = stored.plan ?? {};
  return {
    me: stored.me ?? null,
    users: list(stored.users),
    activities: list(stored.activities),
    kudos: list(stored.kudos),
    comments: list(stored.comments),
    follows: list(stored.follows),
    notifications: list(stored.notifications),
    challenges: list(stored.challenges),
    plan: {
      planId: plan.planId ?? null,
      startedAt: plan.startedAt ?? null,
      completed: plan.completed && typeof plan.completed === 'object' ? plan.completed : {},
      finished: list(plan.finished),
    },
    subscription: stored.subscription ?? { active: false, renewsAt: null },
    premiumAnswers: stored.premiumAnswers ?? null,
    pending: list(stored.pending),
    seededAt: stored.seededAt ?? null,
    lastDemoPostAt: stored.lastDemoPostAt ?? null,
  };
}

function parseState(json) {
  try {
    const stored = JSON.parse(json);
    if (stored && Array.isArray(stored.users) && stored.users.length) return withDefaults(stored);
  } catch {
    // Datos corruptos: se empieza de cero.
  }
  return null;
}

// ---------- Backend ----------

export class LocalBackend {
  constructor() {
    this.mode = 'demo';
    this._state = null;
    this._storage = null;
    this._committed = null; // último estado aceptado (JSON), para deshacer si no cabe en el almacenamiento
    this._initPromise = null;
    this._timer = null;
    this._authListeners = new Set();
    this._eventListeners = new Set();
    this._onStorage = (event) => this._handleStorageEvent(event);
  }

  // ---------- Conexión y persistencia ----------

  init() {
    this._initPromise ??= Promise.resolve().then(() => this._init());
    return this._initPromise;
  }

  _init() {
    this._load();
    this._processDue();
    this._refreshCommunity();
    if (!this._timer && typeof setInterval === 'function') {
      this._timer = setInterval(() => this._tick(), TICK_MS);
      this._timer?.unref?.(); // en Node (tests) no mantiene vivo el proceso
    }
    globalThis.addEventListener?.('storage', this._onStorage);
  }

  _load() {
    this._storage = getStorage();
    let raw = null;
    try {
      raw = this._storage?.getItem(STORAGE_KEY) ?? null;
    } catch (error) {
      console.warn('[demo] No se puede leer el almacenamiento local.', error);
    }
    const stored = raw ? parseState(raw) : null;
    if (stored) {
      this._state = stored;
      this._committed = raw;
    } else {
      this._state = freshState(new Date());
      this._save({ strict: false });
    }
  }

  // Guarda el estado. Si no cabe (fotos), deshace los cambios en memoria y lanza un error para el usuario.
  // Sin almacenamiento disponible (modo privado), la app sigue funcionando en memoria.
  _save({ strict = true } = {}) {
    if (!this._storage) return;
    const json = JSON.stringify(this._state);
    try {
      this._storage.setItem(STORAGE_KEY, json);
    } catch (error) {
      if (!isQuotaError(error)) {
        console.warn('[demo] Sin almacenamiento local: los datos solo duran esta sesión.', error);
        this._storage = null;
        return;
      }
      if (strict) {
        if (this._committed) this._state = parseState(this._committed) ?? this._state;
        throw new Error(QUOTA_MESSAGE);
      }
      console.warn('[demo] Almacenamiento lleno: este cambio solo dura esta sesión.', error);
    }
    this._committed = json;
  }

  // Otra pestaña ha guardado cambios: se recargan para no pisarlos.
  _handleStorageEvent(event) {
    if (event?.key !== STORAGE_KEY || !this._state) return;
    const hadProfile = Boolean(this._state.me);
    const stored = event.newValue ? parseState(event.newValue) : null;
    this._state = stored ?? freshState(new Date());
    this._committed = stored ? event.newValue : null;
    const hasProfile = Boolean(this._state.me);
    if (hadProfile !== hasProfile) this._setAuthState(hasProfile ? 'ready' : 'needs-profile');
    this._emit({ type: 'notification' });
  }

  async _ready() {
    await this.init();
    return this._state;
  }

  async _requireMe() {
    const s = await this._ready();
    if (!s.me) throw new Error(MSG.noProfile);
    return s.me;
  }

  _emit(event) {
    for (const cb of this._eventListeners) {
      try {
        cb(event);
      } catch (error) {
        console.error(error);
      }
    }
  }

  _setAuthState(state) {
    for (const cb of this._authListeners) {
      Promise.resolve()
        .then(() => cb(state))
        .catch((error) => console.error(error));
    }
  }

  // ---------- Auth ----------

  async getAuthState() {
    const s = await this._ready();
    return s.me ? 'ready' : 'needs-profile';
  }

  async signInWithEmail() {
    throw new Error(MSG.demoSignIn);
  }

  async verifyEmailCode() {
    throw new Error(MSG.demoSignIn);
  }

  async createProfile({ name, level = 2, position = null, club = '' } = {}) {
    const s = await this._ready();
    const fields = profilePatch({ name, level, position, club }, { requireName: true });
    if (s.me) {
      Object.assign(s.me, fields); // doble envío: se actualiza
    } else {
      s.me = { id: `me-${randomId()}`, name: '', avatarUrl: null, level: 2, position: null, club: '', bio: '', createdAt: nowIso(), ...fields };
      this._importLegacy(s.me.id);
    }
    this._save();
    this._setAuthState('ready');
    return this.getMe();
  }

  // Trae una sola vez lo registrado con la app anterior (v2 o v1) como actividades mías.
  _importLegacy(meId) {
    const list = this._readLegacy().filter((item) => item && typeof item === 'object' && !item.demo);
    if (!list.length) return;
    try {
      const createdAt = nowIso();
      for (const input of fromLegacy(list)) {
        this._state.activities.push(activityRecord(input, { id: randomId(), userId: meId, createdAt: iso(input.date) ?? createdAt }));
      }
    } catch (error) {
      console.error('[demo] No se ha podido importar el historial anterior.', error);
    }
  }

  _readLegacy() {
    const storage = getStorage();
    if (!storage) return [];
    for (const key of LEGACY_KEYS) {
      try {
        const list = JSON.parse(storage.getItem(key));
        if (Array.isArray(list)) return list; // v2 ya incluía lo migrado de v1
      } catch {
        // Clave ilegible: se prueba la siguiente.
      }
    }
    return [];
  }

  async getMe() {
    const s = await this._ready();
    return s.me ? this._toProfile(s.me) : null;
  }

  async updateMe(patch) {
    const me = await this._requireMe();
    Object.assign(me, profilePatch(patch ?? {}));
    this._save();
    return this.getMe();
  }

  // Borra la cuenta demo de este dispositivo. La próxima vez se empieza con una comunidad nueva.
  async signOut() {
    await this._ready();
    try {
      this._storage?.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[demo] No se ha podido borrar el almacenamiento local.', error);
    }
    this._state = freshState(new Date());
    this._committed = null;
    this._setAuthState('needs-profile');
  }

  onAuthChange(cb) {
    this._authListeners.add(cb);
    return () => this._authListeners.delete(cb);
  }

  // ---------- Perfiles ----------

  _user(id) {
    const s = this._state;
    if (s.me && s.me.id === id) return s.me;
    return s.users.find((u) => u.id === id) ?? null;
  }

  _isFollowing(followerId, followingId) {
    return this._state.follows.some((f) => f.followerId === followerId && f.followingId === followingId);
  }

  _subscriptionStatus(now = Date.now()) {
    const sub = this._state.subscription;
    if (!sub?.active || !sub.renewsAt) return { active: false, renewsAt: null };
    // El pago simulado se renueva solo cada 30 días, como una suscripción real.
    let renews = time(sub.renewsAt);
    while (renews <= now) renews += PREMIUM_PERIOD_MS;
    return { active: true, renewsAt: new Date(renews).toISOString() };
  }

  _profileMin(id) {
    const user = this._user(id);
    if (!user) return { id, name: 'Jugador', avatarUrl: null, isPremium: false };
    const isMe = user === this._state.me;
    const min = {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      isPremium: isMe ? this._subscriptionStatus().active : Boolean(user.isPremium),
    };
    if (user.demo) min.demo = true;
    return min;
  }

  _toProfile(user) {
    const meId = this._state.me?.id ?? null;
    const follows = this._state.follows;
    return {
      ...this._profileMin(user.id),
      level: user.level ?? 2,
      position: user.position ?? null,
      club: user.club ?? '',
      bio: user.bio ?? '',
      createdAt: user.createdAt ?? null,
      followersCount: follows.filter((f) => f.followingId === user.id).length,
      followingCount: follows.filter((f) => f.followerId === user.id).length,
      followedByMe: Boolean(meId) && user.id !== meId && this._isFollowing(meId, user.id),
      isMe: user.id === meId,
    };
  }

  async getProfile(userId) {
    await this._ready();
    const user = this._user(userId);
    return user ? this._toProfile(user) : null;
  }

  async searchPlayers(query) {
    const s = await this._ready();
    const q = fold(query);
    if (!q) return [];
    return s.users
      .filter((u) => u.id !== s.me?.id && fold(u.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .slice(0, 20)
      .map((u) => this._profileMin(u.id));
  }

  // Jugadores que aún no sigo: primero los de mi club y los más seguidos.
  async suggestedPlayers() {
    const s = await this._ready();
    const meId = s.me?.id ?? null;
    const myClub = fold(s.me?.club);
    return s.users
      .filter((u) => u.id !== meId && !(meId && this._isFollowing(meId, u.id)))
      .map((u) => this._toProfile(u))
      .sort((a, b) => {
        const sameClub = Number(Boolean(myClub) && fold(b.club) === myClub) - Number(Boolean(myClub) && fold(a.club) === myClub);
        return sameClub || b.followersCount - a.followersCount || a.name.localeCompare(b.name, 'es');
      })
      .slice(0, 8);
  }

  async follow(userId) {
    const me = await this._requireMe();
    const s = this._state;
    if (userId === me.id) throw new Error(MSG.selfFollow);
    const user = this._user(userId);
    if (!user) throw new Error(MSG.noPlayer);
    if (this._isFollowing(me.id, userId)) return;
    s.follows.push({ followerId: me.id, followingId: userId, createdAt: nowIso() });
    // Demo: a veces el jugador te sigue también al poco rato.
    const alreadyComing = s.pending.some((p) => p.kind === 'follow' && p.actorId === userId);
    if (user.demo && !this._isFollowing(userId, me.id) && !alreadyComing && Math.random() < 0.5) {
      s.pending.push(this._pendingItem('follow', userId, null, randomBetween(10, 30)));
    }
    this._save();
  }

  async unfollow(userId) {
    const me = await this._requireMe();
    const s = this._state;
    s.follows = s.follows.filter((f) => !(f.followerId === me.id && f.followingId === userId));
    s.pending = s.pending.filter((p) => !(p.kind === 'follow' && p.actorId === userId));
    this._save();
  }

  async getFollowing(userId) {
    const s = await this._ready();
    return s.follows
      .filter((f) => f.followerId === userId && this._user(f.followingId))
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
      .map((f) => this._profileMin(f.followingId));
  }

  async getFollowers(userId) {
    const s = await this._ready();
    return s.follows
      .filter((f) => f.followingId === userId && this._user(f.followerId))
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
      .map((f) => this._profileMin(f.followerId));
  }

  // ---------- Actividades ----------

  _circleIds() {
    const meId = this._state.me?.id;
    const ids = new Set(meId ? [meId] : []);
    for (const f of this._state.follows) if (f.followerId === meId) ids.add(f.followingId);
    return ids;
  }

  // Convierte registros en Activity con autor, contadores y si son míos.
  _toActivities(records) {
    const s = this._state;
    const meId = s.me?.id ?? null;
    const wanted = new Set(records.map((r) => r.id));
    const kudos = new Map();
    const comments = new Map();
    for (const k of s.kudos) {
      if (!wanted.has(k.activityId)) continue;
      const entry = kudos.get(k.activityId) ?? { count: 0, mine: false };
      entry.count++;
      if (k.userId === meId) entry.mine = true;
      kudos.set(k.activityId, entry);
    }
    for (const c of s.comments) if (wanted.has(c.activityId)) comments.set(c.activityId, (comments.get(c.activityId) ?? 0) + 1);
    return records.map((r) => ({
      id: r.id,
      userId: r.userId,
      author: this._profileMin(r.userId),
      isMine: r.userId === meId,
      type: r.type,
      date: r.date,
      seconds: r.seconds ?? 0,
      rpe: r.rpe ?? null,
      won: r.won ?? null,
      sets: sanitizeSets(r.sets),
      matchKind: r.matchKind ?? null,
      partner: r.partner ?? '',
      rivals: [...(r.rivals ?? [])],
      club: r.club ?? '',
      title: r.title ?? '',
      text: r.text ?? '',
      photoUrl: r.photoUrl ?? null,
      plan: r.plan ? { ...r.plan } : null,
      focus: r.focus ?? null,
      kudosCount: kudos.get(r.id)?.count ?? 0,
      kudoedByMe: kudos.get(r.id)?.mine ?? false,
      commentsCount: comments.get(r.id) ?? 0,
      createdAt: r.createdAt,
    }));
  }

  // Paginación por (fecha, id), igual que el backend live: no se pierden actividades con la misma fecha.
  _page(records, { before, beforeId, limit = 20 } = {}) {
    const cursor = before == null || before === '' ? NaN : time(before);
    const size = Math.max(1, Math.round(Number(limit) || 20));
    const older = (a) => {
      if (Number.isNaN(cursor)) return true;
      const t = time(a.date);
      return t < cursor || (beforeId != null && t === cursor && a.id < beforeId);
    };
    // El desempate tiene que ser el mismo criterio que el cursor: el id.
    const newestFirst = (a, b) => time(b.date) - time(a.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    return this._toActivities(records.filter(older).sort(newestFirst).slice(0, size));
  }

  async getFeed({ before, beforeId, limit = 20 } = {}) {
    await this._requireMe();
    const ids = this._circleIds();
    return this._page(this._state.activities.filter((a) => ids.has(a.userId)), { before, beforeId, limit });
  }

  async getUserActivities(userId, { before, beforeId, limit = 20 } = {}) {
    const s = await this._ready();
    return this._page(s.activities.filter((a) => a.userId === userId), { before, beforeId, limit });
  }

  async getActivity(id) {
    const s = await this._ready();
    const record = s.activities.find((a) => a.id === id);
    return record ? this._toActivities([record])[0] : null;
  }

  async getMyActivities() {
    const me = await this._requireMe();
    return this._toActivities(this._state.activities.filter((a) => a.userId === me.id).sort(byDateDesc));
  }

  async getCircleActivities({ from, to } = {}) {
    await this._requireMe();
    const ids = this._circleIds();
    const min = from ? time(from) : -Infinity;
    const max = to ? time(to) : Infinity;
    const records = this._state.activities.filter((a) => ids.has(a.userId) && time(a.date) >= min && time(a.date) < max);
    return this._toActivities(records.sort(byDateDesc));
  }

  async createActivity(input, photoBlob = null) {
    const me = await this._requireMe();
    const clean = normalizeActivityInput(input ?? {});
    // La vista ya ha reducido la foto: aquí solo se convierte a data URL para guardarla.
    const photoUrl = !photoBlob ? null : typeof photoBlob === 'string' ? photoBlob : await blobToDataUrl(photoBlob);
    const record = activityRecord(clean, { id: randomId(), userId: me.id, photoUrl, createdAt: nowIso() });
    this._state.activities.push(record);
    this._scheduleReactions(record);
    try {
      this._save();
    } catch (error) {
      // Sin espacio (o sin estado previo al que volver): se quita lo añadido.
      this._state.activities = this._state.activities.filter((a) => a.id !== record.id);
      this._state.pending = this._state.pending.filter((p) => p.activityId !== record.id);
      throw error;
    }
    return this._toActivities([record])[0];
  }

  async deleteActivity(id) {
    const me = await this._requireMe();
    const s = this._state;
    const record = s.activities.find((a) => a.id === id);
    if (!record || record.userId !== me.id) throw new Error('No se ha podido borrar esta actividad.');
    s.activities = s.activities.filter((a) => a.id !== id);
    s.kudos = s.kudos.filter((k) => k.activityId !== id);
    s.comments = s.comments.filter((c) => c.activityId !== id);
    s.notifications = s.notifications.filter((n) => n.activityId !== id);
    s.pending = s.pending.filter((p) => p.activityId !== id);
    this._save();
  }

  // ---------- ¡Vamos! y comentarios ----------

  _activityRecord(id) {
    const record = this._state.activities.find((a) => a.id === id);
    if (!record) throw new Error(MSG.noActivity);
    return record;
  }

  async toggleKudos(activityId) {
    const me = await this._requireMe();
    const s = this._state;
    this._activityRecord(activityId);
    const mine = (k) => k.activityId === activityId && k.userId === me.id;
    const kudoedByMe = !s.kudos.some(mine);
    if (kudoedByMe) s.kudos.push({ activityId, userId: me.id, createdAt: nowIso() });
    else s.kudos = s.kudos.filter((k) => !mine(k));
    this._save();
    return { kudoedByMe, kudosCount: s.kudos.filter((k) => k.activityId === activityId).length };
  }

  async getKudoers(activityId) {
    const s = await this._ready();
    return s.kudos
      .filter((k) => k.activityId === activityId)
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
      .map((k) => this._profileMin(k.userId));
  }

  _toComment(c) {
    return {
      id: c.id,
      activityId: c.activityId,
      author: this._profileMin(c.userId),
      text: c.text,
      createdAt: c.createdAt,
      isMine: c.userId === this._state.me?.id,
    };
  }

  async getComments(activityId) {
    const s = await this._ready();
    return s.comments
      .filter((c) => c.activityId === activityId)
      .sort((a, b) => time(a.createdAt) - time(b.createdAt))
      .map((c) => this._toComment(c));
  }

  async addComment(activityId, text) {
    const me = await this._requireMe();
    const body = String(text ?? '').trim();
    if (!body) throw new Error('Escribe algo antes de enviar.');
    if (body.length > 500) throw new Error('El comentario es demasiado largo (máximo 500 caracteres).');
    this._activityRecord(activityId);
    const comment = { id: randomId(), activityId, userId: me.id, text: body, createdAt: nowIso() };
    this._state.comments.push(comment);
    this._save();
    return this._toComment(comment);
  }

  // Lo borra su autor o el dueño de la actividad (moderar su post).
  async deleteComment(commentId) {
    const me = await this._requireMe();
    const s = this._state;
    const comment = s.comments.find((c) => c.id === commentId);
    if (!comment) return;
    const owner = s.activities.find((a) => a.id === comment.activityId)?.userId;
    if (comment.userId !== me.id && owner !== me.id) throw new Error('No puedes borrar este comentario.');
    s.comments = s.comments.filter((c) => c.id !== commentId);
    s.notifications = s.notifications.filter((n) => n.commentId !== commentId);
    this._save();
  }

  // ---------- Notificaciones e interacciones simuladas ----------

  _pendingItem(kind, actorId, activityId, delaySeconds, text = '') {
    return { id: randomId(), kind, actorId, activityId, text, dueAt: new Date(Date.now() + delaySeconds * SECOND).toISOString() };
  }

  // Tras publicar: 2-3 "¡Vamos!" de gente que sigo (o de otros jugadores de ejemplo) y, a veces, un comentario.
  _scheduleReactions(record) {
    const s = this._state;
    const meId = s.me.id;
    const demoIds = s.users.filter((u) => u.demo).map((u) => u.id);
    const followed = demoIds.filter((id) => this._isFollowing(meId, id));
    const others = demoIds.filter((id) => !followed.includes(id));
    const fans = [...shuffled(followed), ...shuffled(others)].slice(0, randomBetween(2, 3));
    const items = fans.map((actorId) => this._pendingItem('kudos', actorId, record.id, randomBetween(5, 40)));
    if (items.length && Math.random() < 0.6) {
      const kudo = items[Math.floor(Math.random() * items.length)];
      const afterKudo = Math.ceil((time(kudo.dueAt) - Date.now()) / SECOND) + 2;
      const delay = randomBetween(Math.min(afterKudo, 40), 40);
      items.push(this._pendingItem('comment', kudo.actorId, record.id, delay, reactionComment(record)));
    }
    s.pending.push(...items);
  }

  _notify({ kind, actorId, activityId = null, preview = '', createdAt, commentId = null }) {
    const s = this._state;
    s.notifications.push({
      id: randomId(),
      userId: s.me.id,
      kind,
      actorId,
      activityId,
      preview: preview.slice(0, 80),
      read: false,
      createdAt,
      ...(commentId ? { commentId } : {}),
    });
  }

  _applyPending(item) {
    const s = this._state;
    const meId = s.me.id;
    if (!this._user(item.actorId)) return false;
    const at = new Date(Math.min(time(item.dueAt), Date.now())).toISOString();
    if (item.kind === 'follow') {
      if (this._isFollowing(item.actorId, meId)) return false;
      s.follows.push({ followerId: item.actorId, followingId: meId, createdAt: at });
      this._notify({ kind: 'follow', actorId: item.actorId, createdAt: at });
      return true;
    }
    const activity = s.activities.find((a) => a.id === item.activityId);
    if (!activity || activity.userId !== meId) return false;
    if (item.kind === 'kudos') {
      if (s.kudos.some((k) => k.activityId === activity.id && k.userId === item.actorId)) return false;
      s.kudos.push({ activityId: activity.id, userId: item.actorId, createdAt: at });
      this._notify({ kind: 'kudos', actorId: item.actorId, activityId: activity.id, createdAt: at });
      return true;
    }
    if (item.kind === 'comment' && item.text) {
      const comment = { id: randomId(), activityId: activity.id, userId: item.actorId, text: item.text, createdAt: at };
      s.comments.push(comment);
      this._notify({ kind: 'comment', actorId: item.actorId, activityId: activity.id, preview: item.text, createdAt: at, commentId: comment.id });
      return true;
    }
    return false;
  }

  // Aplica las interacciones pendientes que ya tocan (también las que vencieron con la app cerrada).
  _processDue(now = Date.now()) {
    const s = this._state;
    if (!s?.me || !s.pending.length) return 0;
    const due = s.pending.filter((p) => time(p.dueAt) <= now).sort((a, b) => time(a.dueAt) - time(b.dueAt));
    if (!due.length) return 0;
    s.pending = s.pending.filter((p) => time(p.dueAt) > now);
    let applied = 0;
    for (const item of due) if (this._applyPending(item)) applied++;
    this._save({ strict: false });
    if (applied) this._emit({ type: 'notification' });
    return applied;
  }

  _tick() {
    try {
      this._processDue();
    } catch (error) {
      console.error(error);
    }
  }

  // Comunidad viva: si hace más de 20 h de la última, 1-2 publicaciones nuevas de jugadores de ejemplo.
  _refreshCommunity(now = Date.now()) {
    const s = this._state;
    if (s.lastDemoPostAt && now - time(s.lastDemoPostAt) < COMMUNITY_EVERY_MS) return;
    const meId = s.me?.id;
    const authors = shuffled(s.users.filter((u) => u.demo)).slice(0, randomBetween(1, 2));
    for (const author of authors) {
      const record = demoPost(author, { now: new Date(now) });
      s.activities.push(record);
      const fans = shuffled(
        s.follows.filter((f) => f.followingId === author.id && f.followerId !== meId && this._user(f.followerId)).map((f) => f.followerId),
      ).slice(0, randomBetween(1, 3));
      const span = Math.max(SECOND, now - time(record.createdAt));
      for (const fan of fans) {
        s.kudos.push({ activityId: record.id, userId: fan, createdAt: new Date(time(record.createdAt) + Math.random() * span).toISOString() });
      }
      if (fans.length && Math.random() < 0.4) {
        s.comments.push({
          id: randomId(),
          activityId: record.id,
          userId: fans[0],
          text: reactionComment(record),
          createdAt: new Date(time(record.createdAt) + span * 0.8).toISOString(),
        });
      }
    }
    s.lastDemoPostAt = new Date(now).toISOString();
    this._save({ strict: false });
    this._emit({ type: 'feed' });
  }

  async getNotifications({ limit = 50 } = {}) {
    const me = await this._requireMe();
    this._processDue();
    const size = Math.max(1, Math.round(Number(limit) || 50));
    return this._state.notifications
      .filter((n) => n.userId === me.id)
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
      .slice(0, size)
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        actor: this._profileMin(n.actorId),
        activityId: n.activityId ?? null,
        preview: n.preview ?? '',
        read: Boolean(n.read),
        createdAt: n.createdAt,
      }));
  }

  async getUnreadCount() {
    const s = await this._ready();
    if (!s.me) return 0;
    this._processDue();
    return this._state.notifications.filter((n) => n.userId === s.me.id && !n.read).length;
  }

  async markNotificationsRead() {
    const me = await this._requireMe();
    let changed = false;
    for (const n of this._state.notifications) {
      if (n.userId === me.id && !n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this._save();
  }

  subscribe(cb) {
    this._eventListeners.add(cb);
    return () => this._eventListeners.delete(cb);
  }

  // ---------- Retos ----------

  async getJoinedChallenges() {
    const s = await this._ready();
    return [...s.challenges];
  }

  async joinChallenge(instanceId) {
    await this._requireMe();
    const id = String(instanceId ?? '').trim();
    if (!id) throw new Error('Elige un reto para unirte.');
    if (!this._state.challenges.includes(id)) {
      this._state.challenges.push(id);
      this._save();
    }
  }

  async leaveChallenge(instanceId) {
    await this._requireMe();
    const before = this._state.challenges.length;
    this._state.challenges = this._state.challenges.filter((id) => id !== instanceId);
    if (this._state.challenges.length !== before) this._save();
  }

  // ---------- Planes de preparación física ----------

  async getPlanState() {
    const s = await this._ready();
    return clone(s.plan);
  }

  async startPlan(planId) {
    await this._requireMe();
    if (!planId) throw new Error('Elige un plan para empezar.');
    const plan = this._state.plan;
    this._state.plan = { planId: String(planId), startedAt: nowIso(), completed: {}, finished: plan.finished };
    this._save();
    return clone(this._state.plan);
  }

  async completePlanSession(sessionKey, totalSessions) {
    await this._requireMe();
    const plan = this._state.plan;
    if (!plan.planId) throw new Error('Empieza un plan para ir marcando sesiones.');
    plan.completed[String(sessionKey)] = nowIso();
    const total = Number(totalSessions) || 0;
    if (total > 0 && Object.keys(plan.completed).length >= total) {
      plan.finished.push({ planId: plan.planId, finishedAt: nowIso() });
      plan.planId = null;
      plan.startedAt = null;
      plan.completed = {};
    }
    this._save();
    return clone(plan);
  }

  async abandonPlan() {
    await this._requireMe();
    const plan = this._state.plan;
    this._state.plan = { planId: null, startedAt: null, completed: {}, finished: plan.finished };
    this._save();
    return clone(this._state.plan);
  }

  // ---------- Premium (simulado: no se cobra nada) ----------

  async getSubscription() {
    await this._ready();
    const status = this._subscriptionStatus();
    // El Premium simulado se renueva solo hasta que se cancela (y la cancelación es inmediata).
    return { ...status, willRenew: status.active, paymentIssue: false, manageable: status.active, simulated: true };
  }

  // En la demo no hay pasarela: no hay que esperar a ningún webhook al volver.
  checkoutPending() {
    return false;
  }

  clearCheckoutPending() {}

  async startCheckout() {
    await this._requireMe();
    this._state.subscription = { active: true, renewsAt: new Date(Date.now() + PREMIUM_PERIOD_MS).toISOString(), startedAt: nowIso() };
    this._save();
    return this.getSubscription();
  }

  async manageSubscription() {
    await this._requireMe();
    this._state.subscription = { active: false, renewsAt: null };
    this._save();
    return this.getSubscription();
  }

  async getPremiumAnswers() {
    const s = await this._ready();
    return clone(s.premiumAnswers);
  }

  async savePremiumAnswers(answers) {
    await this._requireMe();
    this._state.premiumAnswers = clone(answers ?? {});
    this._save();
    return clone(this._state.premiumAnswers);
  }
}
