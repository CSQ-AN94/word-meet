-- Run once in the Supabase SQL Editor. Re-running preserves existing rooms.
begin;

create schema if not exists word_meet_private;

create table if not exists word_meet_private.rooms (
  code text primary key,
  host_token_hash text not null,
  host_name text not null,
  guest_token_hash text,
  guest_name text,
  session_id uuid,
  created_at bigint not null,
  expires_at bigint not null,
  host_seen bigint not null,
  guest_seen bigint
);
create index if not exists rooms_expiry on word_meet_private.rooms (expires_at);

create table if not exists word_meet_private.messages (
  id bigint generated always as identity primary key,
  code text not null references word_meet_private.rooms (code) on delete cascade,
  session_id uuid not null,
  sender smallint not null check (sender in (0, 1)),
  client_id text not null,
  payload jsonb not null,
  created_at bigint not null,
  unique (code, session_id, sender, client_id)
);
create index if not exists message_poll on word_meet_private.messages (code, session_id, id);

alter table word_meet_private.rooms enable row level security;
alter table word_meet_private.messages enable row level security;
revoke all on schema word_meet_private from public, anon, authenticated;
revoke all on all tables in schema word_meet_private from public, anon, authenticated;
revoke all on all sequences in schema word_meet_private from public, anon, authenticated;

create or replace function word_meet_private.clean_text(value text)
returns text language sql immutable strict set search_path = '' as $$
  select btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function word_meet_private.clean_text(text) from public, anon, authenticated;

create or replace function public.word_meet(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_action text := p_request ->> 'action';
  v_code text := p_request ->> 'code';
  v_name text;
  v_token text := p_request ->> 'token';
  v_hash text;
  v_resume_hash text;
  v_new_token text;
  v_room word_meet_private.rooms%rowtype;
  v_seat integer;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ttl constant bigint := 7200000;
  v_random bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_after bigint := 0;
  v_messages jsonb := '[]'::jsonb;
  v_message jsonb := p_request -> 'message';
  v_payload jsonb;
  v_previous jsonb;
  v_word text;
  v_id text := p_request ->> 'id';
  v_rows integer;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise sqlstate 'PT400' using message = '请求格式无效';
  end if;
  if octet_length(p_request::text) > 4096 then
    raise sqlstate 'PT413' using message = '请求内容过长';
  end if;
  if v_action = 'health' then
    return jsonb_build_object('ok', true, 'transport', 'supabase', 'protocol', 3);
  end if;
  if v_action is null or v_action not in ('create', 'join', 'poll', 'messages', 'leave') then
    raise sqlstate 'PT404' using message = '接口不存在';
  end if;
  if v_action in ('create', 'join') then
    if jsonb_typeof(p_request -> 'name') is distinct from 'string' then
      raise sqlstate 'PT400' using message = '请输入昵称';
    end if;
    v_name := word_meet_private.clean_text(p_request ->> 'name');
    if char_length(v_name) not between 1 and 12 or v_name ~ U&'[\0001-\001F\007F]' then
      raise sqlstate 'PT400' using message = '昵称请写 1–12 个字';
    end if;
    v_new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_hash := encode(sha256(convert_to(v_new_token, 'UTF8')), 'hex');
  end if;

  if v_action = 'create' then
    delete from word_meet_private.rooms where expires_at <= v_now;
    for attempt in 1..5 loop
      v_random := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      v_code := '';
      for i in 0..7 loop
        -- Skip the UUID version byte to retain 40 random bits in the code.
        v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_random, i + case when i >= 6 then 1 else 0 end) & 31), 1);
      end loop;
      insert into word_meet_private.rooms (code, host_token_hash, host_name, created_at, expires_at, host_seen)
        values (v_code, v_hash, v_name, v_now, v_now + v_ttl, v_now)
        on conflict do nothing returning * into v_room;
      exit when v_room.code is not null;
    end loop;
    if v_room.code is null then
      raise sqlstate 'PT503' using message = '房间创建失败，请重试';
    end if;
    v_seat := 0;
  else
    if v_code is null or v_code !~ '^[A-HJ-NP-Z2-9]{8}$' then
      raise sqlstate 'PT400' using message = '房间码无效';
    end if;
    -- Serialize all operations for a room, including competing joins and late leaves.
    select r.* into v_room from word_meet_private.rooms r
      where r.code = v_code and r.expires_at > v_now for update;
    if not found then
      raise sqlstate 'PT404' using message = '找不到房间，房间可能已关闭或过期，请重新建房', detail = 'ROOM_CLOSED';
    end if;
    if v_action = 'join' then
      if p_request ->> 'resumeToken' ~ '^[a-f0-9]{64}$' then
        v_resume_hash := encode(sha256(convert_to(p_request ->> 'resumeToken', 'UTF8')), 'hex');
      end if;
      if v_room.guest_token_hash is not null and coalesce(v_room.guest_seen, 0) >= v_now - 90000
          and v_room.guest_token_hash is distinct from v_resume_hash then
        raise sqlstate 'PT409' using message = '房间已满，每个房间最多两人', detail = 'ROOM_FULL';
      end if;
      update word_meet_private.rooms set guest_token_hash = v_hash, guest_name = v_name,
        guest_seen = v_now, session_id = gen_random_uuid(), expires_at = v_now + v_ttl
        where code = v_code returning * into v_room;
      delete from word_meet_private.messages where code = v_code;
      v_seat := 1;
    else
      if v_token is null or v_token !~ '^[a-f0-9]{64}$' then
        raise sqlstate 'PT401' using message = '本次连接已失效，请重新加入', detail = 'INVALID_TOKEN';
      end if;
      v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
      v_seat := case when v_room.host_token_hash = v_hash then 0 when v_room.guest_token_hash = v_hash then 1 else -1 end;
      if v_seat = -1 then
        raise sqlstate 'PT401' using message = '本次连接已失效，请重新加入', detail = 'INVALID_TOKEN';
      end if;
    end if;
  end if;

  if v_action = 'poll' then
    if p_request ? 'after' then
      if jsonb_typeof(p_request -> 'after') is distinct from 'number' then
        raise sqlstate 'PT400' using message = '消息游标无效';
      end if;
      if (p_request ->> 'after')::numeric not between 0 and 9007199254740991
          or floor((p_request ->> 'after')::numeric) <> (p_request ->> 'after')::numeric then
        raise sqlstate 'PT400' using message = '消息游标无效';
      end if;
      v_after := (p_request ->> 'after')::bigint;
    end if;
    update word_meet_private.rooms set expires_at = v_now + v_ttl,
      host_seen = case when v_seat = 0 then v_now else host_seen end,
      guest_seen = case when v_seat = 1 then v_now else guest_seen end where code = v_code;
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'message', m.payload) order by m.id), '[]'::jsonb),
      coalesce(max(m.id), v_after) into v_messages, v_after
      from (select id, payload from word_meet_private.messages where code = v_code
        and session_id = v_room.session_id and sender <> v_seat and id > v_after order by id limit 200) m;
  elsif v_action = 'messages' then
    if jsonb_typeof(p_request -> 'id') is distinct from 'string' or v_id !~ '^[a-zA-Z0-9-]{1,80}$' then
      raise sqlstate 'PT400' using message = '消息编号无效';
    end if;
    if v_room.session_id is null or jsonb_typeof(v_message) is distinct from 'object'
        or v_message -> 'v' is distinct from '1'::jsonb
        or v_message ->> 'sessionId' is distinct from v_room.session_id::text then
      raise sqlstate 'PT409' using message = '对局已更新，请重新加入', detail = 'SESSION_CHANGED';
    end if;
    if jsonb_typeof(v_message -> 'match') is distinct from 'number'
        or jsonb_typeof(v_message -> 'round') is distinct from 'number' then
      raise sqlstate 'PT400' using message = '对局轮次无效';
    end if;
    if (v_message ->> 'match')::numeric not between 1 and 9007199254740991
        or (v_message ->> 'round')::numeric not between 1 and 9007199254740991
        or floor((v_message ->> 'match')::numeric) <> (v_message ->> 'match')::numeric
        or floor((v_message ->> 'round')::numeric) <> (v_message ->> 'round')::numeric then
      raise sqlstate 'PT400' using message = '对局轮次无效';
    end if;
    v_payload := jsonb_build_object('v', 1, 'sessionId', v_room.session_id,
      'match', (v_message ->> 'match')::bigint, 'round', (v_message ->> 'round')::bigint, 'type', v_message ->> 'type');
    if v_message ->> 'type' = 'commit' and jsonb_typeof(v_message -> 'hash') = 'string'
        and v_message ->> 'hash' ~ '^[a-f0-9]{64}$' then
      v_payload := v_payload || jsonb_build_object('hash', v_message ->> 'hash');
    elsif v_message ->> 'type' = 'ready' then
      null;
    elsif v_message ->> 'type' = 'reveal' and jsonb_typeof(v_message -> 'word') = 'string'
        and jsonb_typeof(v_message -> 'salt') = 'string' and v_message ->> 'salt' ~ '^[a-f0-9]{32}$' then
      v_word := normalize(word_meet_private.clean_text(v_message ->> 'word'), NFC);
      if char_length(v_word) not between 1 and 20 or v_word ~ U&'[\0001-\001F\007F]' then
        raise sqlstate 'PT400' using message = '词语请写 1–20 个字';
      end if;
      v_payload := v_payload || jsonb_build_object('word', v_word, 'salt', v_message ->> 'salt');
    else
      raise sqlstate 'PT400' using message = '对局消息格式无效';
    end if;
    insert into word_meet_private.messages (code, session_id, sender, client_id, payload, created_at)
      values (v_code, v_room.session_id, v_seat, v_id, v_payload, v_now) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      select payload into v_previous from word_meet_private.messages
        where code = v_code and session_id = v_room.session_id and sender = v_seat and client_id = v_id;
      if v_previous is distinct from v_payload then
        raise sqlstate 'PT409' using message = '不能修改已发送的消息';
      end if;
    end if;
    return jsonb_build_object('ok', true);
  elsif v_action = 'leave' then
    if v_seat = 0 then
      delete from word_meet_private.rooms where code = v_code;
    else
      update word_meet_private.rooms set guest_token_hash = null, guest_name = null,
        guest_seen = null, session_id = null where code = v_code;
      delete from word_meet_private.messages where code = v_code;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('code', v_room.code, 'seat', v_seat, 'sessionId', v_room.session_id,
    'names', jsonb_build_array(v_room.host_name, v_room.guest_name),
    'peerOnline', coalesce(v_now - case when v_seat = 0 then v_room.guest_seen else v_room.host_seen end < 45000, false),
    'messages', v_messages, 'after', v_after)
    || case when v_new_token is null then '{}'::jsonb else jsonb_build_object('token', v_new_token) end;
end;
$$;

revoke all on function public.word_meet(jsonb) from public, anon, authenticated;
grant execute on function public.word_meet(jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
