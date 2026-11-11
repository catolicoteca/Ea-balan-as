-- ============================================================================
-- SCRIPT DE ROLLBACK / RECUPERAÇÃO - MIGRAÇÃO 003 (CATÁLOGO DE PREÇOS E ITENS)
-- ============================================================================
-- Execute este script no SQL Editor do Supabase CASO deseje reverter completamente
-- a migração 003_price_catalog.sql, restaurando o schema ao estado anterior.

BEGIN;

-- 1. Remove Triggers e Funções apenas se as tabelas existirem
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'service_order_items') THEN
    DROP TRIGGER IF EXISTS trg_validate_service_order_item_lifecycle ON public.service_order_items;
    DROP TRIGGER IF EXISTS trg_service_order_items_updated_at ON public.service_order_items;
    DROP POLICY IF EXISTS so_items_select_policy ON public.service_order_items;
    DROP POLICY IF EXISTS so_items_insert_policy ON public.service_order_items;
    DROP POLICY IF EXISTS so_items_update_policy ON public.service_order_items;
    DROP POLICY IF EXISTS so_items_delete_policy ON public.service_order_items;
    DROP TABLE IF EXISTS public.service_order_items CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_catalog_items') THEN
    DROP TRIGGER IF EXISTS trg_price_catalog_items_updated_at ON public.price_catalog_items;
    DROP POLICY IF EXISTS catalog_items_select_policy ON public.price_catalog_items;
    DROP POLICY IF EXISTS catalog_items_insert_policy ON public.price_catalog_items;
    DROP POLICY IF EXISTS catalog_items_update_policy ON public.price_catalog_items;
    DROP POLICY IF EXISTS catalog_items_delete_policy ON public.price_catalog_items;
    DROP TABLE IF EXISTS public.price_catalog_items CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_catalog_imports') THEN
    DROP POLICY IF EXISTS catalog_imports_select_policy ON public.price_catalog_imports;
    DROP POLICY IF EXISTS catalog_imports_insert_policy ON public.price_catalog_imports;
    DROP TABLE IF EXISTS public.price_catalog_imports CASCADE;
  END IF;
END $$;

-- 2. Remove Funções Auxiliares da Migração 003
DROP FUNCTION IF EXISTS public.validate_service_order_item_lifecycle();

COMMIT;
