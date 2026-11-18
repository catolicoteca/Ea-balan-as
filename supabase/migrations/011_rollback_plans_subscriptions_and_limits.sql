-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Rollback 011: Reversão de Planos, Assinaturas e Limites de Recursos
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_enforce_equipments_limit ON public.equipments;
DROP TRIGGER IF EXISTS trg_enforce_clients_limit ON public.clients;
DROP TRIGGER IF EXISTS trg_enforce_users_limit ON public.company_memberships;
DROP TRIGGER IF EXISTS trg_enforce_technician_limit ON public.technicians;

DROP FUNCTION IF EXISTS public.trg_enforce_company_equipments_limit();
DROP FUNCTION IF EXISTS public.trg_enforce_company_clients_limit();
DROP FUNCTION IF EXISTS public.trg_enforce_company_users_limit();
DROP FUNCTION IF EXISTS public.trg_enforce_company_technician_limit();

DROP FUNCTION IF EXISTS public.check_company_feature_enabled(uuid, text);
DROP FUNCTION IF EXISTS public.get_company_effective_plan(uuid);

DROP TABLE IF EXISTS public.plan_audit_logs CASCADE;
DROP TABLE IF EXISTS public.company_plan_overrides CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.plans CASCADE;

COMMIT;
