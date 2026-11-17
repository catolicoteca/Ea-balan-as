-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 010a: Adição do valor 'stock_manager' ao enum app_role
-- ============================================================================
-- Isolada sem transação interna para atualização segura do catálogo PostgreSQL
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'stock_manager';
