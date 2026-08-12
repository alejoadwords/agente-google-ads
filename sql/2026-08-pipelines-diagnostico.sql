-- Diagnóstico: ¿por qué quedaron leads sin pipeline?
-- Solo lee, no cambia nada.

select
  l.user_id,
  l.client_id,
  count(*) as leads_sin_pipeline,
  -- ¿ese usuario tiene algún pipeline, y de qué ámbito?
  (select count(*) from pipelines p where p.user_id = l.user_id) as pipelines_del_usuario,
  (select count(*) from pipelines p
    where p.user_id = l.user_id and p.client_id is null and p.is_default) as tiene_principal_de_cuenta,
  (select count(*) from pipeline_stages s where s.user_id = l.user_id) as etapas_del_usuario
from leads l
where l.pipeline_id is null
group by l.user_id, l.client_id
order by leads_sin_pipeline desc;
