-- PadelFit v3 · esquema inicial de Supabase (Postgres 15).
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega este archivo entero → Run.
-- Se puede volver a ejecutar sin romper nada (if not exists / or replace / drop ... if exists).
-- Contrato: docs/ARCHITECTURE.md, sección "Esquema de datos". Los nombres de tablas y columnas
-- los usa js/backend/supabase.js tal cual: no los cambies sin cambiar también el backend.
--
-- Reglas de seguridad (RLS):
--   · Todo el mundo autenticado puede leer perfiles, actividades, "¡Vamos!", comentarios y follows.
--   · Cada usuario solo escribe lo suyo. premium_until y subscriptions solo los toca el webhook
--     de Stripe (service role, que se salta RLS).
--   · Las notificaciones las crean triggers; el destinatario solo puede leerlas y marcarlas leídas.

-- =====================================================================================
-- 1. Tablas
-- =====================================================================================

create table if not exists public.profiles (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  avatar_url text,
  level smallint not null default 1 check (level between 1 and 3),
  position text check (position in ('drive', 'reves')),
  club text not null default '' check (char_length(club) <= 80),
  bio text not null default '' check (char_length(bio) <= 500),
  premium_until timestamptz,
  active_plan_id text,
  active_plan_started_at timestamptz,
  created_at timestamptz not null default now()
);

-- Una fila por suscripción de Stripe: un mismo usuario puede llegar a tener varias (pagar dos
-- veces, o que otro pague con su id). premium_until se calcula sobre todas las suyas.
create table if not exists public.subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  type text not null check (type in ('partido', 'clase', 'entreno')),
  played_at timestamptz not null default now(),
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 86400),
  rpe smallint check (rpe between 1 and 10),
  won boolean,
  -- [[juegos nuestros, juegos suyos], ...]; [] si no se apuntó el marcador
  -- Solo pares [entero 0-99, entero 0-99]: la app pinta estos valores en el marcador.
  sets jsonb not null default '[]'::jsonb
    check (case when jsonb_typeof(sets) = 'array' then
      jsonb_array_length(sets) <= 5
      and not jsonb_path_exists(sets, 'strict $[*] ? (@.type() != "array" || @.size() != 2)')
      and not jsonb_path_exists(sets, 'strict $[*][*] ? (@.type() != "number" || @ < 0 || @ > 99 || @ != @.floor())')
    else false end),
  match_kind text check (match_kind in ('amistoso', 'liga', 'torneo', 'americana')),
  partner text not null default '' check (char_length(partner) <= 80),
  rivals text[] not null default '{}' check (cardinality(rivals) <= 10),
  club text not null default '' check (char_length(club) <= 80),
  title text not null default '' check (char_length(title) <= 140),
  body text not null default '' check (char_length(body) <= 2000),
  -- Ruta dentro del bucket 'photos', siempre en la carpeta del autor: '<uid>/<archivo>.jpg'.
  -- Nunca una URL externa (cargaría imágenes de terceros en el muro de los demás).
  photo_path text check (photo_path is null or (
    split_part(photo_path, '/', 1) = user_id::text and photo_path ~ '^[0-9a-f-]+/[A-Za-z0-9._-]+$'
  )),
  plan_id text,
  plan_session text,
  focus text,
  created_at timestamptz not null default now()
);

create table if not exists public.kudos (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- Dos claves ajenas a profiles: para incrustar el autor en PostgREST usa
-- 'profiles!notifications_actor_id_fkey(...)'.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,   -- destinatario
  actor_id uuid not null references public.profiles (id) on delete cascade,  -- quien lo provoca
  kind text not null check (kind in ('kudos', 'comment', 'follow')),
  activity_id uuid references public.activities (id) on delete cascade,
  preview text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.challenge_participants (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  challenge_id text not null check (char_length(challenge_id) between 1 and 80),  -- instanceId, p. ej. 'partidos-mes:2026-10'
  joined_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

create table if not exists public.plan_progress (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  plan_id text not null,
  session_key text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, plan_id, session_key)
);

create table if not exists public.plan_finishes (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  plan_id text not null,
  finished_at timestamptz not null default now(),
  primary key (user_id, plan_id, finished_at)
);

create table if not exists public.premium_answers (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =====================================================================================
-- 2. Índices
-- =====================================================================================

create index if not exists activities_user_played_idx on public.activities (user_id, played_at desc);
create index if not exists activities_played_idx on public.activities (played_at desc);
create index if not exists kudos_user_idx on public.kudos (user_id);
create index if not exists comments_activity_created_idx on public.comments (activity_id, created_at);
create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where not read;
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

-- =====================================================================================
-- 3. Normalización (triggers before): convierten null en '' / [] para que un insert con
--    campos vacíos no falle por "not null" y los datos lleguen limpios a la app.
-- =====================================================================================

create or replace function public.profiles_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Empezar el plan personalizado exige Premium (si caduca después, el plan no se corta).
  if new.active_plan_id = 'premium'
     and (tg_op = 'INSERT' or old.active_plan_id is distinct from 'premium')
     and not (new.premium_until is not null and new.premium_until > now()) then
    raise exception 'El plan personalizado es para usuarios Premium.' using errcode = '42501';
  end if;
  new.name := btrim(new.name);
  new.level := coalesce(new.level, 1);
  new.position := nullif(new.position, '');
  new.club := coalesce(btrim(new.club), '');
  new.bio := coalesce(btrim(new.bio), '');
  return new;
end;
$$;

drop trigger if exists profiles_normalize on public.profiles;
create trigger profiles_normalize
  before insert or update on public.profiles
  for each row execute function public.profiles_normalize();

create or replace function public.activities_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.played_at := coalesce(new.played_at, now());
  new.duration_seconds := coalesce(new.duration_seconds, 0);
  if new.sets is null or jsonb_typeof(new.sets) = 'null' then
    new.sets := '[]'::jsonb;
  end if;
  new.rivals := coalesce(new.rivals, '{}');
  new.partner := coalesce(btrim(new.partner), '');
  new.club := coalesce(btrim(new.club), '');
  new.title := coalesce(btrim(new.title), '');
  new.body := coalesce(btrim(new.body), '');
  new.match_kind := nullif(new.match_kind, '');
  new.focus := nullif(new.focus, '');
  return new;
end;
$$;

drop trigger if exists activities_normalize on public.activities;
create trigger activities_normalize
  before insert on public.activities
  for each row execute function public.activities_normalize();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists premium_answers_touch on public.premium_answers;
create trigger premium_answers_touch
  before update on public.premium_answers
  for each row execute function public.touch_updated_at();

-- =====================================================================================
-- 4. Notificaciones automáticas (security definer: escriben en la bandeja de otro usuario).
--    Nunca se notifica a uno mismo. Si se quita el "¡Vamos!", el follow o el comentario,
--    se borra su notificación.
-- =====================================================================================

create or replace function public.notify_kudos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, actor_id, kind, activity_id, preview)
    select a.user_id, new.user_id, 'kudos', new.activity_id, ''
    from public.activities a
    where a.id = new.activity_id and a.user_id <> new.user_id;
  else
    delete from public.notifications
    where kind = 'kudos' and actor_id = old.user_id and activity_id = old.activity_id;
  end if;
  return null;
end;
$$;

create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, actor_id, kind, activity_id, preview)
    select a.user_id, new.user_id, 'comment', new.activity_id, left(new.body, 80)
    from public.activities a
    where a.id = new.activity_id and a.user_id <> new.user_id;
  else
    -- notifications no guarda el id del comentario: se borra la más reciente que coincide.
    delete from public.notifications
    where id = (
      select n.id from public.notifications n
      where n.kind = 'comment' and n.actor_id = old.user_id
        and n.activity_id = old.activity_id and n.preview = left(old.body, 80)
      order by n.created_at desc
      limit 1
    );
  end if;
  return null;
end;
$$;

create or replace function public.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.following_id <> new.follower_id then
      insert into public.notifications (user_id, actor_id, kind, activity_id, preview)
      values (new.following_id, new.follower_id, 'follow', null, '');
    end if;
  else
    delete from public.notifications
    where kind = 'follow' and actor_id = old.follower_id and user_id = old.following_id;
  end if;
  return null;
end;
$$;

-- Solo se ejecutan como triggers: nadie debe poder llamarlas por RPC.
revoke all on function public.notify_kudos() from public;
revoke all on function public.notify_comment() from public;
revoke all on function public.notify_follow() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.notify_kudos() from anon, authenticated;
    revoke all on function public.notify_comment() from anon, authenticated;
    revoke all on function public.notify_follow() from anon, authenticated;
  end if;
end;
$$;

drop trigger if exists kudos_notify on public.kudos;
create trigger kudos_notify
  after insert or delete on public.kudos
  for each row execute function public.notify_kudos();

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert or delete on public.comments
  for each row execute function public.notify_comment();

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert or delete on public.follows
  for each row execute function public.notify_follow();

-- ¿El usuario actual tiene Premium? (security definer para que RLS pueda consultarlo.)
create or replace function public.is_premium()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and premium_until > now());
$$;
revoke all on function public.is_premium() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.is_premium() to authenticated;
  end if;
end;
$$;

-- =====================================================================================
-- 5. Row Level Security
--    (select auth.uid()) en lugar de auth.uid(): Postgres lo evalúa una vez por consulta.
-- =====================================================================================

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.activities enable row level security;
alter table public.kudos enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.notifications enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.plan_progress enable row level security;
alter table public.plan_finishes enable row level security;
alter table public.premium_answers enable row level security;

-- profiles: lectura para autenticados; cada uno crea y edita solo el suyo (sin borrar:
-- al eliminar la cuenta de auth.users se borra todo en cascada).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- subscriptions: cada uno ve la suya; solo escribe el webhook (service role).
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

-- activities: lectura para autenticados; crear y borrar, el dueño (sin edición en el MVP).
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated using (true);

drop policy if exists activities_insert_own on public.activities;
create policy activities_insert_own on public.activities
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists activities_delete_own on public.activities;
create policy activities_delete_own on public.activities
  for delete to authenticated using (user_id = (select auth.uid()));

-- kudos ("¡Vamos!")
drop policy if exists kudos_select on public.kudos;
create policy kudos_select on public.kudos
  for select to authenticated using (true);

drop policy if exists kudos_insert_own on public.kudos;
create policy kudos_insert_own on public.kudos
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists kudos_delete_own on public.kudos;
create policy kudos_delete_own on public.kudos
  for delete to authenticated using (user_id = (select auth.uid()));

-- comments: borra el autor del comentario o el dueño de la actividad (moderar su post).
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated using (true);

drop policy if exists comments_insert_own on public.comments;
create policy comments_insert_own on public.comments
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments
  for delete to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.activities a
      where a.id = comments.activity_id and a.user_id = (select auth.uid())
    )
  );

-- follows
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows
  for select to authenticated using (true);

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert to authenticated with check (follower_id = (select auth.uid()));

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete to authenticated using (follower_id = (select auth.uid()));

-- notifications: el destinatario las lee y las marca como leídas (solo la columna read).
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Datos privados: solo el propio usuario (leer, crear, cambiar y borrar).
drop policy if exists challenge_participants_own on public.challenge_participants;
create policy challenge_participants_own on public.challenge_participants
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists plan_progress_own on public.plan_progress;
create policy plan_progress_own on public.plan_progress
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (plan_id <> 'premium' or public.is_premium()));

drop policy if exists plan_finishes_own on public.plan_finishes;
create policy plan_finishes_own on public.plan_finishes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- premium_answers: leer y borrar, el dueño; guardar respuestas nuevas exige Premium.
drop policy if exists premium_answers_own on public.premium_answers;
create policy premium_answers_own on public.premium_answers
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_premium());

-- =====================================================================================
-- 6. Privilegios por columna (segunda barrera además de RLS).
--    Supabase da todos los privilegios de las tablas de public a anon y authenticated;
--    aquí se recortan para que nadie pueda darse Premium a sí mismo.
-- =====================================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- profiles: premium_until y created_at no se pueden escribir desde la app.
    -- (id está en update solo para que funcione un upsert; RLS impide cambiarlo.)
    revoke insert, update on table public.profiles from anon, authenticated;
    -- avatar_url tampoco: aún no hay subida de avatar y una URL externa filtraría la IP de quien la ve.
    grant insert (id, name, level, position, club, bio, active_plan_id, active_plan_started_at)
      on table public.profiles to authenticated;
    grant update (id, name, level, position, club, bio, active_plan_id, active_plan_started_at)
      on table public.profiles to authenticated;

    -- notifications: las crean los triggers; el usuario solo cambia "read".
    revoke insert, update, delete on table public.notifications from anon, authenticated;
    grant update (read) on table public.notifications to authenticated;

    -- subscriptions: solo lectura (la escribe el webhook).
    revoke insert, update, delete on table public.subscriptions from anon, authenticated;
  end if;

  -- El webhook de Stripe usa service_role (se salta RLS, pero necesita privilegios).
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.profiles, public.subscriptions to service_role;
  end if;
end;
$$;

-- =====================================================================================
-- 7. Storage: bucket público 'photos'. Cada usuario solo sube, cambia o borra en '<uid>/...'.
--    (RLS ya viene activado en storage.objects; no hace falta alter table.)
-- =====================================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Lectura: al ser un bucket público, cualquiera ve una foto con su URL pública (getPublicUrl) sin
-- pasar por esta política. La política solo permite listar/consultar objetos por la API (lo que
-- además necesitan remove y upsert) y se limita a usuarios con sesión para no exponer el listado.
drop policy if exists photos_public_read on storage.objects;
drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select to authenticated using (bucket_id = 'photos');

drop policy if exists photos_insert_own on storage.objects;
create policy photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists photos_update_own on storage.objects;
create policy photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists photos_delete_own on storage.objects;
create policy photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =====================================================================================
-- 8. Realtime: la campana recibe las notificaciones nuevas al momento
--    (Realtime respeta la política select: cada uno solo recibe las suyas).
-- =====================================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
