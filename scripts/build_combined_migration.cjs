const fs = require('fs');

let s004 = fs.readFileSync('supabase/migrations/004_seed_real_price_catalog.sql', 'utf8');
let s005 = fs.readFileSync('supabase/migrations/005_technician_invitation_system.sql', 'utf8');
let s008a = fs.readFileSync('supabase/migrations/008a_add_administrator_enum.sql', 'utf8');
let s008b = fs.readFileSync('supabase/migrations/008b_administrator_and_employee_auth.sql', 'utf8');

// Strip BEGIN and COMMIT from 004 and 005
s004 = s004.replace(/^\s*BEGIN\s*;\s*$/m, '-- [004 BEGIN unificado]');
s004 = s004.replace(/^\s*COMMIT\s*;\s*$/m, '-- [004 COMMIT unificado]');

s005 = s005.replace(/^\s*BEGIN\s*;\s*$/m, '-- [005 BEGIN unificado]');
s005 = s005.replace(/^\s*COMMIT\s*;\s*$/m, '-- [005 COMMIT unificado]');

const header = `-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Pacote Consolidado de Migrações Restantes para Staging (004 + 005 + 008a + 008b)
-- ============================================================================
-- Estrutura de Transações:
-- 1. Transação 1: Seed do Catálogo (004) + Convites de Técnicos (005) + Enum (008a)
--    -> Comita para registrar o valor 'administrator' no catálogo pg_enum do PostgreSQL.
-- 2. Transação 2: Estruturas, Funções Seguras, RLS e Suporte Auditado (008b)
--    -> Utiliza o valor 'administrator' com segurança e comita atomicamente.
-- ============================================================================

-- >>> INÍCIO TRANSAÇÃO 1: CATÁLOGO, CONVITES E ENUM DE PAPÉIS <<<
BEGIN;
`;

const middle = `
-- ----------------------------------------------------------------------------
-- MIGRAÇÃO 008a: ADIÇÃO DO VALOR 'administrator' AO ENUM app_role
-- ----------------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'administrator';

COMMIT;
-- >>> FIM TRANSAÇÃO 1 (ENUM REGISTRADO NO POSTGRESQL) <<<

-- >>> INÍCIO TRANSAÇÃO 2: 4º PERFIL, RLS, IDENTIFICADORES E AUDITORIA (008b) <<<
BEGIN;
`;

const footer = `
COMMIT;
-- >>> FIM TRANSAÇÃO 2 (INSTALAÇÃO CONCLUÍDA COM SUCESSO) <<<
`;

const combined = header + '\n' + s004 + '\n\n' + s005 + '\n\n' + middle + '\n' + s008b + '\n' + footer;

fs.writeFileSync('supabase/migrations/metrion_staging_combined_004_005_008a_008b.sql', combined, 'utf8');
console.log('Combined migration file successfully generated! Size:', combined.length, 'bytes');
