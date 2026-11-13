-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 008a: Adição do valor 'administrator' ao enum app_role
-- ============================================================================
-- Esta etapa isolada garante compatibilidade total com o catálogo do PostgreSQL,
-- permitindo que a transação de DDL do tipo encerre normalmente antes do uso
-- do novo valor nas estruturas, funções e políticas de segurança da etapa 008b.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'administrator';
