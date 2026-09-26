-- peluquerias_agente_usage: nadie la lee desde la API. Solo service_role
-- (la Edge Function) y SQL. Se quita la lectura para authenticated.
drop policy if exists peluquerias_agente_usage_select_authenticated
  on public.peluquerias_agente_usage;

-- Tope global de peluquerias-agente: filas de las últimas 24 h, todas las sesiones.
create index if not exists peluquerias_agente_usage_created_idx
  on public.peluquerias_agente_usage (created_at desc);
