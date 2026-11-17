-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Rollback 010b: Reversão do Módulo de Estoque e Baixa Automática
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_auto_deplete_stock_on_so_item_applied ON public.service_order_items;
DROP FUNCTION IF EXISTS public.trg_auto_deplete_stock_on_so_item_applied();

DROP TRIGGER IF EXISTS trg_ensure_technician_stock ON public.technicians;
DROP FUNCTION IF EXISTS public.ensure_technician_vehicle_stock_location();

DROP TRIGGER IF EXISTS trg_ensure_company_default_stock ON public.companies;
DROP FUNCTION IF EXISTS public.ensure_company_default_stock_location();

DROP FUNCTION IF EXISTS public.get_low_stock_alerts(uuid);
DROP FUNCTION IF EXISTS public.process_stock_transfer(uuid, uuid, uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.process_stock_entry(uuid, uuid, uuid, text, text, text, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public.is_company_stock_manager(uuid);

DROP TABLE IF EXISTS public.stock_movements CASCADE;
DROP TABLE IF EXISTS public.inventory_items CASCADE;
DROP TABLE IF EXISTS public.stock_locations CASCADE;

COMMIT;
