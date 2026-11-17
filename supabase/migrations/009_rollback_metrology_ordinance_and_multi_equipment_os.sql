-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Rollback 009: Reversão de Múltiplas Balanças e Portaria Inmetro
-- ============================================================================

DROP POLICY IF EXISTS so_equipments_delete_policy ON public.service_order_equipments;
DROP POLICY IF EXISTS so_equipments_update_policy ON public.service_order_equipments;
DROP POLICY IF EXISTS so_equipments_insert_policy ON public.service_order_equipments;
DROP POLICY IF EXISTS so_equipments_select_policy ON public.service_order_equipments;

DROP TABLE IF EXISTS public.service_order_equipments CASCADE;

ALTER TABLE public.equipments
  DROP COLUMN IF EXISTS inmetro_ordinance;
