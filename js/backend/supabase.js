// Backend "live": Supabase (Auth con enlace mágico, Postgres con RLS, Storage para fotos y Realtime para
// notificaciones) + Stripe Payment Links para Premium. Cumple la interfaz de docs/ARCHITECTURE.md.
// supabase-js se carga bajo demanda desde el CDN, así la versión demo no descarga nada.

import { normalizeActivityInput, POSITIONS, sanitizeSets } from '../activities.js';

const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const PHOTOS_BUCKET = 'photos';
const PAGE_SIZE = 1000; // máximo de filas por petición en Supabase (max_rows por defecto)

const PROFILE_MIN = 'id,name,avatar_url,premium_until';
const PROFILE_FULL = `${PROFILE_MIN},level,position,club,bio,created_at`;
const ACTIVITY_SELECT = `*, author:profiles!activities_user_id_fkey(${PROFILE_MIN}), kudos(user_id), comments(count)`;
const COMMENT_SELECT = `id, activity_id, user_id, body, created_at, author:profiles!comments_user_id_fkey(${PROFILE_MIN})`;
const NOTIFICATION_SELECT =
  `id, kind, activity_id, preview, read, created_at, actor_id, actor:profiles!notifications_actor_id_fkey(${PROFILE_MIN})`;

const MSG = {
  connect: 'No se ha podido conectar con el servidor. Revisa tu conexión.',
  session: 'Tu sesión ha caducado. Vuelve a entrar con tu email.',
  me: 'No se ha podido cargar tu perfil. Revisa tu conexión.',
  feed: 'No se ha podido cargar el muro. Revisa tu conexión.',
  activity: 'No se ha podido cargar la actividad. Revisa tu conexión.',
  publish: 'No se ha podido publicar. Revisa tu conexión e inténtalo de nuevo.',
  photo: 'No se ha podido subir la foto. Prueba de nuevo o publica sin ella.',
  remove: 'No se ha podido borrar. Inténtalo de nuevo.',
  profile: 'No se ha podido cargar el perfil. Revisa tu conexión.',
  players: 'No se han podido cargar los jugadores. Revisa tu conexión.',
  follow: 'No se ha podido actualizar a quién sigues. Inténtalo de nuevo.',
  kudos: 'No se ha podido dar el ¡Vamos! Inténtalo de nuevo.',
  comments: 'No se han podido cargar los comentarios.',
  comment: 'No se ha podido enviar el comentario. Inténtalo de nuevo.',
  notifications: 'No se han podido cargar las notificaciones.',
  challenges: 'No se han podido actualizar los retos. Inténtalo de nuevo.',
  plan: 'No se ha podido guardar tu plan. Revisa tu conexión.',
  premium: 'No se ha podido cargar tu suscripción. Revisa tu conexión.',
  answers: 'No se han podido guardar tus respuestas. Inténtalo de nuevo.',
};

// ---------- Utilidades puras ----------

const iso = (value) => (value ? new Date(value).toISOString() : null);
const nowIso = () => new Date().toISOString();
const cleanText = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const isDuplicate = (error) => error?.code === '23505';
const isBadId = (error) => error?.code === '22P02'; // texto que no es un uuid válido
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Estados de Stripe con Premium hasta el final del periodo (past_due: cobro fallido que se reintenta).
const LIVE_SUBSCRIPTION = ['active', 'trialing', 'past_due'];
const CHECKOUT_FLAG = 'padelfit:checkout';

// Paginación por (played_at, id): con solo played_at se perderían las actividades empatadas en la
// fecha de la última de la página (p. ej. los 4 jugadores de un partido publicando la misma hora).
function olderThan(query, before, beforeId) {
  if (!before) return query;
  const date = iso(before);
  if (!beforeId || !UUID.test(beforeId)) return query.lt('played_at', date);
  return query.or(`played_at.lt."${date}",and(played_at.eq."${date}",id.lt.${beforeId})`);
}

const newestFirst = (query) => query.order('played_at', { ascending: false }).order('id', { ascending: false });

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isPremiumRow(row) {
  return Boolean(row?.premium_until) && new Date(row.premium_until).getTime() > Date.now();
}

function toProfileMin(row, fallbackId = '') {
  if (!row) return { id: fallbackId, name: 'Jugador', avatarUrl: null, isPremium: false };
  return { id: row.id, name: row.name ?? '', avatarUrl: row.avatar_url || null, isPremium: isPremiumRow(row) };
}

// Escapa los comodines de LIKE (% _ \) y quita '*', que PostgREST trata como '%'.
function likePattern(query) {
  return `%${query.replace(/\*/g, '').replace(/[\\%_]/g, '\\$&')}%`;
}

// Valida y recorta los campos editables del perfil (límites de la migración). Solo devuelve las claves del parche.
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

function activityRow(input, userId, photoPath) {
  const plan = input.plan?.planId ? input.plan : null;
  return {
    user_id: userId,
    type: input.type,
    played_at: iso(input.date) ?? nowIso(),
    duration_seconds: Math.max(0, Math.round(Number(input.seconds) || 0)),
    rpe: input.rpe ?? null,
    won: input.won ?? null,
    sets: input.sets ?? [],
    match_kind: input.matchKind ?? null,
    partner: input.partner ?? '',
    rivals: input.rivals ?? [],
    club: input.club ?? '',
    title: input.title ?? '',
    body: input.text ?? '',
    photo_path: photoPath,
    plan_id: plan?.planId ?? null,
    plan_session: plan ? plan.sessionKey ?? null : null,
    focus: input.focus ?? null,
  };
}

// Añade parámetros a un enlace de Stripe (Payment Link o portal de cliente).
function stripeUrl(link, params) {
  let url;
  try {
    url = new URL(link);
  } catch (error) {
    console.error('[supabase]', error);
    throw new Error('El enlace de pago no está bien configurado.');
  }
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  return counts;
}

// ---------- Backend ----------

export class SupabaseBackend {
  constructor(config) {
    this.config = config;
    this.mode = 'live';
    this._client = null;
    this._initPromise = null;
    this._authSubscription = null;
    this._session = null;
    this._own = null; // { uid, row } fila de profiles del usuario actual (row = null si aún no tiene perfil)
    this._authState = null; // último estado comunicado a onAuthChange
    this._authListeners = new Set();
    this._eventListeners = new Set();
    this._channel = null;
    this._channelUid = null;
  }

  get _uid() {
    return this._session?.user?.id ?? null;
  }

  // ---------- Conexión y sesión ----------

  init() {
    this._initPromise ??= this._init().catch((error) => {
      this._initPromise = null; // permite reintentar
      throw error;
    });
    return this._initPromise;
  }

  async _init() {
    if (!this._client) {
      let createClient;
      try {
        ({ createClient } = await import(SUPABASE_JS_URL));
      } catch (error) {
        this._fail(error, MSG.connect);
      }
      this._client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }

    // getSession espera a que se procese el enlace mágico de la URL, si lo hay.
    const { data, error } = await this._client.auth.getSession();
    if (error) console.error(error); // p. ej. enlace caducado: seguimos sin sesión
    this._session = data?.session ?? null;
    if (this._uid) await this._ownRow({ fresh: true });
    this._authState = this._currentAuthState();

    // No se llama a Supabase dentro del callback (puede bloquear el cliente): se difiere un tick.
    this._authSubscription ??= this._client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => this._handleAuthEvent(session), 0);
    }).data.subscription;
    this._syncChannel();
  }

  async _handleAuthEvent(session) {
    this._session = session ?? null;
    if (this._own && this._own.uid !== this._uid) this._own = null;
    this._syncChannel();
    try {
      this._setAuthState(await this.getAuthState());
    } catch (error) {
      console.error(error);
    }
  }

  // Avisa a los oyentes solo si el estado cambia (los refrescos de token no deben repintar la app).
  _setAuthState(state) {
    if (state === this._authState) return;
    this._authState = state;
    for (const cb of this._authListeners) {
      Promise.resolve()
        .then(() => cb(state))
        .catch((error) => console.error(error));
    }
  }

  _currentAuthState() {
    if (!this._uid) return 'signed-out';
    return this._own?.uid === this._uid && this._own.row ? 'ready' : 'needs-profile';
  }

  async _auth() {
    await this.init();
    const uid = this._uid;
    if (!uid) throw new Error(MSG.session);
    return { sb: this._client, uid };
  }

  _fail(error, message) {
    console.error('[supabase]', error);
    throw new Error(message);
  }

  _check({ data, error }, message) {
    if (error) this._fail(error, message);
    return data;
  }

  async _all(makeQuery, message) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const data = this._check(await makeQuery().range(from, from + PAGE_SIZE - 1), message);
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  async _count(table, filters, message) {
    let query = this._client.from(table).select('*', { count: 'exact', head: true });
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { count, error } = await query;
    if (error) this._fail(error, message);
    return count ?? 0;
  }

  // Fila de profiles del usuario actual (en caché salvo fresh).
  async _ownRow({ fresh = false } = {}) {
    const uid = this._uid;
    if (!uid) return null;
    if (!fresh && this._own?.uid === uid) return this._own.row;
    const row = this._check(await this._client.from('profiles').select('*').eq('id', uid).maybeSingle(), MSG.me);
    if (uid === this._uid) this._own = { uid, row };
    return row;
  }

  async _updateOwn(patch, message) {
    const { sb, uid } = await this._auth();
    const row = this._check(await sb.from('profiles').update(patch).eq('id', uid).select('*').single(), message);
    if (uid === this._uid) this._own = { uid, row };
    return row;
  }

  // ---------- Auth ----------

  async getAuthState() {
    await this.init();
    if (this._uid && this._own?.uid !== this._uid) await this._ownRow();
    return this._currentAuthState();
  }

  async signInWithEmail(email) {
    await this.init();
    const address = String(email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Escribe un email válido.');
    const emailRedirectTo = this.config.appUrl || `${location.origin}${location.pathname}`;
    const { error } = await this._client.auth.signInWithOtp({ email: address, options: { emailRedirectTo } });
    if (!error) return;
    if (error.status === 429) this._fail(error, 'Espera un minuto antes de pedir otro enlace.');
    this._fail(error, 'No se ha podido enviar el enlace. Revisa el email e inténtalo de nuevo.');
  }

  // Código de 6 cifras del mismo email: necesario en la app instalada en iPhone, donde el enlace abre
  // Safari y la sesión no llega a la app (cada una tiene su propio almacenamiento).
  async verifyEmailCode(email, code) {
    await this.init();
    const address = String(email ?? '').trim().toLowerCase();
    const token = String(code ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(token)) throw new Error('El código tiene 6 cifras.');
    const { error } = await this._client.auth.verifyOtp({ email: address, token, type: 'email' });
    if (!error) return;
    if (error.status === 429) this._fail(error, 'Demasiados intentos. Espera un minuto.');
    this._fail(error, 'El código no es válido o ha caducado. Pide uno nuevo.');
  }

  async createProfile({ name, level = 2, position = null, club = '' } = {}) {
    const { sb, uid } = await this._auth();
    const fields = profilePatch({ name, level, position, club }, { requireName: true });
    let { data, error } = await sb.from('profiles').insert({ id: uid, ...fields }).select('*').single();
    if (isDuplicate(error)) {
      // Ya existía (doble envío): se actualiza.
      ({ data, error } = await sb.from('profiles').update(fields).eq('id', uid).select('*').single());
    }
    if (error) this._fail(error, 'No se ha podido crear tu perfil. Inténtalo de nuevo.');
    this._own = { uid, row: data };
    this._setAuthState('ready');
    return this.getMe();
  }

  async getMe() {
    await this.init();
    const row = await this._ownRow({ fresh: true });
    if (!row) return null;
    return this._toProfile(row, await this._followCounts(row.id));
  }

  async updateMe(patch) {
    const fields = profilePatch(patch);
    if (Object.keys(fields).length) await this._updateOwn(fields, 'No se han podido guardar los cambios. Inténtalo de nuevo.');
    return this.getMe();
  }

  async signOut() {
    await this.init();
    const { error } = await this._client.auth.signOut({ scope: 'local' });
    if (error) this._fail(error, 'No se ha podido cerrar la sesión. Inténtalo de nuevo.');
    this._session = null;
    this._own = null;
    this._syncChannel();
    this._setAuthState('signed-out');
  }

  onAuthChange(cb) {
    this._authListeners.add(cb);
    return () => this._authListeners.delete(cb);
  }

  // ---------- Perfiles y seguidores ----------

  async getProfile(userId) {
    const { sb, uid } = await this._auth();
    const { data: row, error } = await sb.from('profiles').select(PROFILE_FULL).eq('id', userId).maybeSingle();
    if (isBadId(error)) return null;
    if (error) this._fail(error, MSG.profile);
    if (!row) return null;
    const [counts, followedByMe] = await Promise.all([
      this._followCounts(userId),
      userId === uid
        ? false
        : this._count('follows', { follower_id: uid, following_id: userId }, MSG.profile).then((n) => n > 0),
    ]);
    return this._toProfile(row, { ...counts, followedByMe });
  }

  async searchPlayers(query) {
    const { sb, uid } = await this._auth();
    const q = cleanText(query);
    if (!q) return [];
    const rows = this._check(
      await sb.from('profiles').select(PROFILE_MIN).ilike('name', likePattern(q)).neq('id', uid).order('name').limit(20),
      MSG.players,
    );
    return rows.map((row) => toProfileMin(row));
  }

  async suggestedPlayers() {
    const { sb, uid } = await this._auth();
    const excluded = [uid, ...(await this._followingIds(uid))];
    const rows = this._check(
      await sb
        .from('profiles')
        .select(PROFILE_FULL)
        .not('id', 'in', `(${excluded.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(8),
      MSG.players,
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [followers, following] = await Promise.all([
      this._all(() => sb.from('follows').select('following_id').in('following_id', ids), MSG.players),
      this._all(() => sb.from('follows').select('follower_id').in('follower_id', ids), MSG.players),
    ]);
    const followersBy = countBy(followers, 'following_id');
    const followingBy = countBy(following, 'follower_id');
    return rows.map((row) =>
      this._toProfile(row, {
        followersCount: followersBy.get(row.id) ?? 0,
        followingCount: followingBy.get(row.id) ?? 0,
        followedByMe: false,
      }),
    );
  }

  async follow(userId) {
    const { sb, uid } = await this._auth();
    if (userId === uid) throw new Error('No puedes seguirte a ti mismo.');
    const { error } = await sb.from('follows').insert({ follower_id: uid, following_id: userId });
    if (error && !isDuplicate(error)) this._fail(error, MSG.follow);
  }

  async unfollow(userId) {
    const { sb, uid } = await this._auth();
    this._check(await sb.from('follows').delete().eq('follower_id', uid).eq('following_id', userId), MSG.follow);
  }

  async getFollowing(userId) {
    const { sb } = await this._auth();
    const rows = this._check(
      await sb
        .from('follows')
        .select(`following_id, profile:profiles!follows_following_id_fkey(${PROFILE_MIN})`)
        .eq('follower_id', userId)
        .order('created_at', { ascending: false }),
      MSG.players,
    );
    return rows.map((r) => toProfileMin(r.profile, r.following_id));
  }

  async getFollowers(userId) {
    const { sb } = await this._auth();
    const rows = this._check(
      await sb
        .from('follows')
        .select(`follower_id, profile:profiles!follows_follower_id_fkey(${PROFILE_MIN})`)
        .eq('following_id', userId)
        .order('created_at', { ascending: false }),
      MSG.players,
    );
    return rows.map((r) => toProfileMin(r.profile, r.follower_id));
  }

  async _followingIds(uid) {
    const rows = await this._all(() => this._client.from('follows').select('following_id').eq('follower_id', uid), MSG.feed);
    return rows.map((r) => r.following_id);
  }

  async _followCounts(userId) {
    const [followersCount, followingCount] = await Promise.all([
      this._count('follows', { following_id: userId }, MSG.profile),
      this._count('follows', { follower_id: userId }, MSG.profile),
    ]);
    return { followersCount, followingCount };
  }

  _toProfile(row, { followersCount = 0, followingCount = 0, followedByMe = false } = {}) {
    return {
      ...toProfileMin(row),
      level: row.level ?? 2,
      position: row.position ?? null,
      club: row.club ?? '',
      bio: row.bio ?? '',
      createdAt: iso(row.created_at),
      followersCount,
      followingCount,
      followedByMe,
      isMe: row.id === this._uid,
    };
  }

  // ---------- Actividades ----------

  async getFeed({ before, beforeId, limit = 20 } = {}) {
    const { sb, uid } = await this._auth();
    const ids = [uid, ...(await this._followingIds(uid))];
    const query = olderThan(sb.from('activities').select(ACTIVITY_SELECT).in('user_id', ids), before, beforeId);
    const rows = this._check(await newestFirst(query).limit(limit), MSG.feed);
    return rows.map((row) => this._toActivity(row));
  }

  async getUserActivities(userId, { before, beforeId, limit = 20 } = {}) {
    const { sb } = await this._auth();
    const query = olderThan(sb.from('activities').select(ACTIVITY_SELECT).eq('user_id', userId), before, beforeId);
    const { data, error } = await newestFirst(query).limit(limit);
    if (isBadId(error)) return [];
    if (error) this._fail(error, MSG.feed);
    return data.map((row) => this._toActivity(row));
  }

  async getActivity(id) {
    const { sb } = await this._auth();
    const { data, error } = await sb.from('activities').select(ACTIVITY_SELECT).eq('id', id).maybeSingle();
    if (isBadId(error)) return null;
    if (error) this._fail(error, MSG.activity);
    return data ? this._toActivity(data) : null;
  }

  async getMyActivities() {
    const { sb, uid } = await this._auth();
    const rows = await this._all(
      () => sb.from('activities').select(ACTIVITY_SELECT).eq('user_id', uid).order('played_at', { ascending: false }),
      MSG.feed,
    );
    return rows.map((row) => this._toActivity(row));
  }

  async getCircleActivities({ from, to } = {}) {
    const { sb, uid } = await this._auth();
    const ids = [uid, ...(await this._followingIds(uid))];
    const rows = await this._all(() => {
      let query = sb.from('activities').select(ACTIVITY_SELECT).in('user_id', ids);
      if (from) query = query.gte('played_at', iso(from));
      if (to) query = query.lt('played_at', iso(to));
      return query.order('played_at', { ascending: false });
    }, MSG.feed);
    return rows.map((row) => this._toActivity(row));
  }

  async createActivity(input, photoBlob = null) {
    const { sb, uid } = await this._auth();
    const clean = normalizeActivityInput(input ?? {});
    const photoPath = photoBlob ? await this._uploadPhoto(uid, photoBlob) : null;
    const { data, error } = await sb.from('activities').insert(activityRow(clean, uid, photoPath)).select(ACTIVITY_SELECT).single();
    if (error) {
      if (photoPath) this._removePhoto(photoPath);
      this._fail(error, MSG.publish);
    }
    return this._toActivity(data);
  }

  async deleteActivity(id) {
    const { sb, uid } = await this._auth();
    const rows = this._check(
      await sb.from('activities').delete().eq('id', id).eq('user_id', uid).select('id, photo_path'),
      MSG.remove,
    );
    if (!rows.length) throw new Error('No se ha podido borrar esta actividad.');
    if (rows[0].photo_path) this._removePhoto(rows[0].photo_path);
  }

  async _uploadPhoto(uid, blob) {
    const path = `${uid}/${randomId()}.jpg`;
    const { error } = await this._client.storage
      .from(PHOTOS_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (error) this._fail(error, MSG.photo);
    return path;
  }

  // Limpieza en segundo plano: si falla, solo queda un archivo huérfano.
  _removePhoto(path) {
    this._client.storage
      .from(PHOTOS_BUCKET)
      .remove([path])
      .then(({ error }) => error && console.error('[supabase]', error))
      .catch((error) => console.error('[supabase]', error));
  }

  // Solo rutas del bucket propio: nunca una URL externa (filtraría la IP de quien ve el muro).
  _photoUrl(path) {
    if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
    return this._client.storage.from(PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  _toActivity(row) {
    const kudos = row.kudos ?? [];
    return {
      id: row.id,
      userId: row.user_id,
      author: toProfileMin(row.author, row.user_id),
      isMine: row.user_id === this._uid,
      type: row.type,
      date: iso(row.played_at),
      seconds: row.duration_seconds ?? 0,
      rpe: row.rpe ?? null,
      won: row.won ?? null,
      sets: sanitizeSets(row.sets),
      matchKind: row.match_kind ?? null,
      partner: row.partner ?? '',
      rivals: row.rivals ?? [],
      club: row.club ?? '',
      title: row.title ?? '',
      text: row.body ?? '',
      photoUrl: this._photoUrl(row.photo_path),
      plan: row.plan_id ? { planId: row.plan_id, sessionKey: row.plan_session ?? '' } : null,
      focus: row.focus ?? null,
      kudosCount: kudos.length,
      kudoedByMe: kudos.some((k) => k.user_id === this._uid),
      commentsCount: row.comments?.[0]?.count ?? 0,
      createdAt: iso(row.created_at),
    };
  }

  // ---------- ¡Vamos! y comentarios ----------

  async toggleKudos(activityId) {
    const { sb, uid } = await this._auth();
    const existing = this._check(
      await sb.from('kudos').select('user_id').eq('activity_id', activityId).eq('user_id', uid).maybeSingle(),
      MSG.kudos,
    );
    let kudoedByMe;
    if (existing) {
      this._check(await sb.from('kudos').delete().eq('activity_id', activityId).eq('user_id', uid), MSG.kudos);
      kudoedByMe = false;
    } else {
      const { error } = await sb.from('kudos').insert({ activity_id: activityId, user_id: uid });
      if (error && !isDuplicate(error)) this._fail(error, MSG.kudos);
      kudoedByMe = true;
    }
    const kudosCount = await this._count('kudos', { activity_id: activityId }, MSG.kudos);
    return { kudoedByMe, kudosCount };
  }

  async getKudoers(activityId) {
    const { sb } = await this._auth();
    const rows = this._check(
      await sb
        .from('kudos')
        .select(`user_id, profile:profiles!kudos_user_id_fkey(${PROFILE_MIN})`)
        .eq('activity_id', activityId)
        .order('created_at', { ascending: false }),
      MSG.activity,
    );
    return rows.map((r) => toProfileMin(r.profile, r.user_id));
  }

  async getComments(activityId) {
    const { sb } = await this._auth();
    const rows = this._check(
      await sb.from('comments').select(COMMENT_SELECT).eq('activity_id', activityId).order('created_at', { ascending: true }),
      MSG.comments,
    );
    return rows.map((row) => this._toComment(row));
  }

  async addComment(activityId, text) {
    const { sb, uid } = await this._auth();
    const body = String(text ?? '').trim();
    if (!body) throw new Error('Escribe algo antes de enviar.');
    if (body.length > 500) throw new Error('El comentario es demasiado largo (máximo 500 caracteres).');
    const row = this._check(
      await sb.from('comments').insert({ activity_id: activityId, user_id: uid, body }).select(COMMENT_SELECT).single(),
      MSG.comment,
    );
    return this._toComment(row);
  }

  async deleteComment(commentId) {
    const { sb } = await this._auth();
    this._check(await sb.from('comments').delete().eq('id', commentId), MSG.remove);
  }

  _toComment(row) {
    return {
      id: row.id,
      activityId: row.activity_id,
      author: toProfileMin(row.author, row.user_id),
      text: row.body ?? '',
      createdAt: iso(row.created_at),
      isMine: row.user_id === this._uid,
    };
  }

  // ---------- Notificaciones ----------

  async getNotifications({ limit = 50 } = {}) {
    const { sb, uid } = await this._auth();
    const rows = this._check(
      await sb
        .from('notifications')
        .select(NOTIFICATION_SELECT)
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(limit),
      MSG.notifications,
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actor: toProfileMin(row.actor, row.actor_id),
      activityId: row.activity_id ?? null,
      preview: row.preview ?? '',
      read: Boolean(row.read),
      createdAt: iso(row.created_at),
    }));
  }

  async getUnreadCount() {
    const { uid } = await this._auth();
    return this._count('notifications', { user_id: uid, read: false }, MSG.notifications);
  }

  async markNotificationsRead() {
    const { sb, uid } = await this._auth();
    this._check(await sb.from('notifications').update({ read: true }).eq('user_id', uid).eq('read', false), MSG.notifications);
  }

  subscribe(cb) {
    this._eventListeners.add(cb);
    this._syncChannel();
    return () => {
      this._eventListeners.delete(cb);
      this._syncChannel();
    };
  }

  // Mantiene un único canal Realtime para el usuario con sesión (o ninguno si no hay sesión u oyentes).
  _syncChannel() {
    if (!this._client) return;
    const wanted = this._uid && this._eventListeners.size ? this._uid : null;
    if (wanted === this._channelUid) return;
    if (this._channel) this._client.removeChannel(this._channel);
    this._channel = null;
    this._channelUid = wanted;
    if (!wanted) return;
    this._channel = this._client
      .channel(`notifications:${wanted}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${wanted}` },
        () => this._emit({ type: 'notification' }),
      )
      .subscribe();
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

  // ---------- Retos ----------

  async getJoinedChallenges() {
    const { sb, uid } = await this._auth();
    const rows = await this._all(() => sb.from('challenge_participants').select('challenge_id').eq('user_id', uid), MSG.challenges);
    return [...new Set(rows.map((r) => r.challenge_id))];
  }

  async joinChallenge(instanceId) {
    const { sb, uid } = await this._auth();
    const { error } = await sb.from('challenge_participants').insert({ user_id: uid, challenge_id: instanceId });
    if (error && !isDuplicate(error)) this._fail(error, MSG.challenges);
  }

  async leaveChallenge(instanceId) {
    const { sb, uid } = await this._auth();
    this._check(
      await sb.from('challenge_participants').delete().eq('user_id', uid).eq('challenge_id', instanceId),
      MSG.challenges,
    );
  }

  // ---------- Planes de preparación física ----------

  async getPlanState() {
    const { sb, uid } = await this._auth();
    const row = await this._ownRow({ fresh: true });
    const planId = row?.active_plan_id ?? null;
    const startedAt = iso(row?.active_plan_started_at);
    const [progress, finishes] = await Promise.all([
      planId ? this._planProgress(uid, planId, startedAt) : [],
      this._all(
        () => sb.from('plan_finishes').select('plan_id, finished_at').eq('user_id', uid).order('finished_at', { ascending: true }),
        MSG.plan,
      ),
    ]);
    return {
      planId,
      startedAt: planId ? startedAt : null,
      completed: Object.fromEntries(progress.map((p) => [p.session_key, iso(p.completed_at)])),
      finished: finishes.map((f) => ({ planId: f.plan_id, finishedAt: iso(f.finished_at) })),
    };
  }

  // Sesiones completadas del plan activo desde que se empezó (las de intentos anteriores no cuentan).
  _planProgress(uid, planId, startedAt) {
    return this._all(() => {
      let query = this._client.from('plan_progress').select('session_key, completed_at').eq('user_id', uid).eq('plan_id', planId);
      if (startedAt) query = query.gte('completed_at', startedAt);
      return query.order('completed_at', { ascending: true });
    }, MSG.plan);
  }

  async startPlan(planId) {
    const { sb, uid } = await this._auth();
    if (!planId) throw new Error('Elige un plan para empezar.');
    this._check(await sb.from('plan_progress').delete().eq('user_id', uid).eq('plan_id', planId), MSG.plan);
    await this._updateOwn({ active_plan_id: planId, active_plan_started_at: nowIso() }, MSG.plan);
    return this.getPlanState();
  }

  async completePlanSession(sessionKey, totalSessions) {
    const { sb, uid } = await this._auth();
    const row = await this._ownRow({ fresh: true });
    const planId = row?.active_plan_id;
    if (!planId) throw new Error('Empieza un plan para ir marcando sesiones.');
    this._check(
      await sb
        .from('plan_progress')
        .upsert(
          { user_id: uid, plan_id: planId, session_key: String(sessionKey), completed_at: nowIso() },
          { onConflict: 'user_id,plan_id,session_key' },
        ),
      MSG.plan,
    );
    const done = (await this._planProgress(uid, planId, iso(row.active_plan_started_at))).length;
    if (totalSessions > 0 && done >= totalSessions) {
      const { error } = await sb.from('plan_finishes').insert({ user_id: uid, plan_id: planId, finished_at: nowIso() });
      if (error && !isDuplicate(error)) this._fail(error, MSG.plan);
      await this._updateOwn({ active_plan_id: null, active_plan_started_at: null }, MSG.plan);
    }
    return this.getPlanState();
  }

  async abandonPlan() {
    await this._updateOwn({ active_plan_id: null, active_plan_started_at: null }, MSG.plan);
    return this.getPlanState();
  }

  // ---------- Premium (Stripe) ----------

  async getSubscription() {
    const { sb, uid } = await this._auth();
    const row = await this._ownRow({ fresh: true });
    const subs = this._check(
      await sb.from('subscriptions').select('status, cancel_at_period_end').eq('user_id', uid),
      MSG.premium,
    );
    const live = subs.filter((s) => LIVE_SUBSCRIPTION.includes(s.status));
    return {
      active: isPremiumRow(row),
      renewsAt: iso(row?.premium_until),
      // Se renueva sola salvo que el usuario la haya cancelado para final de periodo.
      willRenew: live.some((s) => !s.cancel_at_period_end),
      // Ha fallado un cobro: hay que actualizar la tarjeta en el portal de Stripe, no volver a pagar.
      paymentIssue: live.some((s) => s.status === 'past_due'),
      // Tiene una suscripción en Stripe que se puede gestionar desde el portal.
      manageable: live.length > 0,
      simulated: false,
    };
  }

  // Redirige a Stripe. El webhook (Edge Function stripe-webhook) actualiza premium_until al pagar.
  // La marca en sessionStorage permite a la vista mostrar "Activando tu Premium…" al volver, mientras
  // el webhook termina (puede tardar unos segundos más que la redirección).
  async startCheckout() {
    const { uid } = await this._auth();
    const link = this.config.stripePaymentLink;
    if (!link) throw new Error('Los pagos aún no están configurados.');
    try {
      sessionStorage.setItem(CHECKOUT_FLAG, String(Date.now()));
    } catch {
      // Sin almacenamiento: al volver se verá el paywall hasta recargar.
    }
    location.href = stripeUrl(link, { client_reference_id: uid, prefilled_email: this._session?.user?.email });
  }

  // ¿Volvemos de pagar en Stripe hace poco? (para esperar al webhook en lugar de mostrar el paywall)
  checkoutPending() {
    try {
      const at = Number(sessionStorage.getItem(CHECKOUT_FLAG));
      if (at && Date.now() - at < 15 * 60 * 1000) return true;
      sessionStorage.removeItem(CHECKOUT_FLAG);
    } catch {
      // Sin almacenamiento: no hay marca.
    }
    return false;
  }

  clearCheckoutPending() {
    try {
      sessionStorage.removeItem(CHECKOUT_FLAG);
    } catch {
      // Nada que limpiar.
    }
  }

  async manageSubscription() {
    await this._auth();
    const portal = this.config.stripeCustomerPortal;
    if (!portal) throw new Error('La gestión de la suscripción aún no está disponible. Escríbenos y te ayudamos.');
    location.href = stripeUrl(portal, { prefilled_email: this._session?.user?.email });
  }

  async getPremiumAnswers() {
    const { sb, uid } = await this._auth();
    const row = this._check(await sb.from('premium_answers').select('answers').eq('user_id', uid).maybeSingle(), MSG.premium);
    return row?.answers ?? null;
  }

  async savePremiumAnswers(answers) {
    const { sb, uid } = await this._auth();
    this._check(
      await sb.from('premium_answers').upsert({ user_id: uid, answers: answers ?? {}, updated_at: nowIso() }, { onConflict: 'user_id' }),
      MSG.answers,
    );
    return answers;
  }
}
