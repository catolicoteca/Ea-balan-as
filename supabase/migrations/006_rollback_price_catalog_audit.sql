-- ============================================================================
-- EA Balanças / Metrion — Rollback Seguro da Migração 006
-- (Auditoria de Alterações no Catálogo de Preços)
--
-- GARANTIA DE PRESERVAÇÃO DE DADOS:
-- Este script remove apenas a trigger e a função de auditoria automática,
-- preservando integralmente a tabela public.price_catalog_history e todo o
-- histórico já registrado sem remoção de dados sem confirmação explícita.
-- Execute somente APÓS o 007_rollback_catalog_configurable_discounts.sql (se 007
-- tiver sido aplicada).
-- ============================================================================

BEGIN;

-- 1. Remove a trigger automática de auditoria em price_catalog_items
DROP TRIGGER IF EXISTS trg_audit_price_catalog_changes ON public.price_catalog_items;

-- 2. Remove a função associada à trigger de auditoria
DROP FUNCTION IF EXISTS public.audit_price_catalog_changes();

-- 3. REMOÇÃO OPCIONAL DA TABELA DE HISTÓRICO (SOMENTE COM CONFIRMAÇÃO EXPLÍCITA)
-- Mantido comentado intencionalmente para preservar trilha de auditoria gravada.
-- Descomente APENAS se desejar descartar permanentemente todo o histórico:
/*
DROP POLICY IF EXISTS catalog_history_select_policy ON public.price_catalog_history;
DROP TABLE IF EXISTS public.price_catalog_history;
*/

COMMIT;
