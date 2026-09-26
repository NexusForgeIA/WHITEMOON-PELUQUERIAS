-- Metering de peluquerias-agente (capa IA del chat de la demo de peluquería).
-- Solo cifras: NUNCA el texto de los mensajes (son datos personales).
-- Sirve también para el bloqueo en servidor: 15 mensajes por session_id,
-- 2 fuera de ámbito seguidos por session_id y 60 mensajes/hora por ip_hash.
-- ip_hash es SHA-256 de la IP con sal; la IP en claro no se guarda.

create table public.peluquerias_agente_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id text not null check (char_length(session_id) between 8 and 64),
  token text not null default 'demo-peluquerias',
  ip_hash text not null check (char_length(ip_hash) = 64),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  fuera_de_ambito boolean not null default false,
  fallback boolean not null default false
);

comment on table public.peluquerias_agente_usage is
  'Metering de peluquerias-agente: tokens por mensaje de usuario. Solo cifras, nunca texto.';

create index peluquerias_agente_usage_sesion_idx
  on public.peluquerias_agente_usage (session_id, created_at desc);
create index peluquerias_agente_usage_ip_idx
  on public.peluquerias_agente_usage (ip_hash, created_at desc);

alter table public.peluquerias_agente_usage enable row level security;

-- anon: nada. authenticated: solo lectura. Escribe solo service_role (la Edge Function).
revoke all on public.peluquerias_agente_usage from anon;
revoke insert, update, delete, truncate on public.peluquerias_agente_usage from authenticated;

create policy peluquerias_agente_usage_select_authenticated
  on public.peluquerias_agente_usage for select to authenticated using (true);
create policy peluquerias_agente_usage_insert_service
  on public.peluquerias_agente_usage for insert to service_role with check (true);
