-- 2026-08-27 · Poner al día la "última actividad" de los leads que ya existen.
--
-- Todo lo que mide inactividad (el Pulso, el badge de la tarjeta, el filtro
-- «Sin actividad» y el disparador lead_inactive de las automatizaciones) lee
-- leads.updated_at. Hasta hoy ese campo solo se movía al EDITAR la ficha, así
-- que registrar una llamada no contaba: un lead atendido ayer podía salir como
-- abandonado desde hacía una semana.
--
-- El código ya está arreglado, pero solo para lo que pase de ahora en adelante.
-- Esto arregla el pasado: adelanta updated_at hasta la última actividad real de
-- cada lead.
--
-- Es seguro de correr:
--   · Solo ADELANTA fechas (a.ultima > l.updated_at). Nunca envejece un lead,
--     así que no puede hacer que aparezca como abandonado algo que no lo está.
--   · No toca leads sin actividades registradas.
--   · Es idempotente: correrlo dos veces no cambia nada la segunda vez.
--
-- Los tipos son los mismos que cuenta el código: trabajar el lead es actividad.
-- Quedan fuera 'stage_change' y 'creacion' porque esas ya venían con una
-- escritura de la propia fila.

-- Antes: cuántos leads están mintiendo hoy.
SELECT count(*) AS leads_a_corregir
FROM leads l
JOIN (
  SELECT lead_id, max(created_at) AS ultima
  FROM lead_activities
  WHERE type IN ('llamada', 'email', 'reunion', 'nota', 'tarea')
  GROUP BY lead_id
) a ON a.lead_id = l.id
WHERE a.ultima > l.updated_at;

-- El arreglo.
UPDATE leads l
SET updated_at = a.ultima
FROM (
  SELECT lead_id, max(created_at) AS ultima
  FROM lead_activities
  WHERE type IN ('llamada', 'email', 'reunion', 'nota', 'tarea')
  GROUP BY lead_id
) a
WHERE l.id = a.lead_id
  AND a.ultima > l.updated_at;

-- Después: tiene que devolver 0.
SELECT count(*) AS deberia_ser_cero
FROM leads l
JOIN (
  SELECT lead_id, max(created_at) AS ultima
  FROM lead_activities
  WHERE type IN ('llamada', 'email', 'reunion', 'nota', 'tarea')
  GROUP BY lead_id
) a ON a.lead_id = l.id
WHERE a.ultima > l.updated_at;
