-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 011: Módulo Completo de Planos, Assinaturas, Limites de Recursos no Banco,
--                Sobrescritas por Empresa com Auditoria e Preparação para Gateway
-- ============================================================================
-- Dependências: Migrações 001..010b já aplicadas.
-- Idempotente: Seguro para execução única ou repetida.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABELA DE PLANOS DE ASSINATURA DA PLATAFORMA (CRUD SUPER ADMIN)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) >= 2),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  price numeric(10, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  max_technicians integer CHECK (max_technicians IS NULL OR max_technicians >= 0),
  max_users integer CHECK (max_users IS NULL OR max_users >= 0),
  max_clients integer CHECK (max_clients IS NULL OR max_clients >= 0),
  max_equipments integer CHECK (max_equipments IS NULL OR max_equipments >= 0),
  max_storage_mb integer CHECK (max_storage_mb IS NULL OR max_storage_mb >= 0),
  max_monthly_os integer CHECK (max_monthly_os IS NULL OR max_monthly_os >= 0),
  features jsonb NOT NULL DEFAULT '{
    "stock": true,
    "multi_scale_os": true,
    "gps_routing": true,
    "pdf_reports": true,
    "signatures": true,
    "photos": true,
    "custom_logo": true,
    "api_access": false
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_slug ON public.plans(slug);
CREATE INDEX IF NOT EXISTS idx_plans_active_sort ON public.plans(is_active, sort_order);

-- ----------------------------------------------------------------------------
-- 2. TABELA DE ASSINATURAS DAS EMPRESAS (TENANTS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'suspended')),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  canceled_at timestamptz,
  payment_gateway text DEFAULT 'manual',
  payment_gateway_subscription_id text,
  payment_gateway_customer_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_subscription UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON public.subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- ----------------------------------------------------------------------------
-- 3. TABELA DE SOBRESCRITA INDIVIDUAL DE PLANOS POR EMPRESA (OVERRIDE CUSTOMIZADO)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_plan_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  override_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  override_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 3),
  authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_override UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_overrides_company ON public.company_plan_overrides(company_id);

-- ----------------------------------------------------------------------------
-- 4. REGISTRO DE AUDITORIA DE ALTERAÇÕES DE PLANOS E ASSINATURAS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state jsonb DEFAULT '{}'::jsonb,
  new_state jsonb DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_audit_company ON public.plan_audit_logs(company_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. FUNÇÕES DE RESOLUÇÃO EFETIVA DE LIMITES E RECURSOS NO BANCO
-- ----------------------------------------------------------------------------

-- 5.1 Retorna plano consolidado com limites e features (considerando overrides)
CREATE OR REPLACE FUNCTION public.get_company_effective_plan(p_company_id uuid)
RETURNS TABLE (
  company_id uuid,
  plan_id uuid,
  plan_name text,
  plan_slug text,
  subscription_status text,
  billing_cycle text,
  trial_ends_at timestamptz,
  is_customized boolean,
  effective_limits jsonb,
  effective_features jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub record;
  v_plan record;
  v_override record;
  v_limits jsonb;
  v_features jsonb;
  v_is_custom boolean := false;
BEGIN
  -- Busca assinatura ativa ou em trial
  SELECT * INTO v_sub
    FROM public.subscriptions
   WHERE subscriptions.company_id = p_company_id;

  IF FOUND THEN
    SELECT * INTO v_plan FROM public.plans WHERE id = v_sub.plan_id;
  ELSE
    -- Fallback padrão: plano Profissional
    SELECT * INTO v_plan FROM public.plans WHERE slug = 'profissional' LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO v_plan FROM public.plans ORDER BY sort_order LIMIT 1;
    END IF;
  END IF;

  -- Monta limites padrão do plano
  v_limits := jsonb_build_object(
    'max_technicians', v_plan.max_technicians,
    'max_users', v_plan.max_users,
    'max_clients', v_plan.max_clients,
    'max_equipments', v_plan.max_equipments,
    'max_storage_mb', v_plan.max_storage_mb,
    'max_monthly_os', v_plan.max_monthly_os
  );
  v_features := coalesce(v_plan.features, '{}'::jsonb);

  -- Aplica sobrescritas individuais se existirem
  SELECT * INTO v_override
    FROM public.company_plan_overrides
   WHERE company_plan_overrides.company_id = p_company_id;

  IF FOUND THEN
    v_is_custom := true;
    IF v_override.override_limits IS NOT NULL AND v_override.override_limits <> '{}'::jsonb THEN
      v_limits := v_limits || v_override.override_limits;
    END IF;
    IF v_override.override_features IS NOT NULL AND v_override.override_features <> '{}'::jsonb THEN
      v_features := v_features || v_override.override_features;
    END IF;
  END IF;

  RETURN QUERY SELECT
    p_company_id,
    v_plan.id,
    v_plan.name,
    v_plan.slug,
    coalesce(v_sub.status, 'active'),
    coalesce(v_sub.billing_cycle, v_plan.billing_cycle),
    v_sub.trial_ends_at,
    v_is_custom,
    v_limits,
    v_features;
END;
$$;

-- 5.2 Verifica se funcionalidade específica está habilitada para a empresa
CREATE OR REPLACE FUNCTION public.check_company_feature_enabled(
  p_company_id uuid,
  p_feature_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective record;
BEGIN
  -- Super admin sempre tem bypass
  IF public.is_platform_admin() THEN
    RETURN true;
  END IF;

  SELECT * INTO v_effective FROM public.get_company_effective_plan(p_company_id);
  IF NOT FOUND THEN
    RETURN true;
  END IF;

  RETURN coalesce((v_effective.effective_features ->> p_feature_key)::boolean, false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. GATILHOS DE ENFORCEMENT DE LIMITES NO BANCO DE DADOS (BACKEND STRICT)
-- ----------------------------------------------------------------------------

-- 6.1 Limite de Técnicos
CREATE OR REPLACE FUNCTION public.trg_enforce_company_technician_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective record;
  v_max integer;
  v_current_count integer;
BEGIN
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_effective FROM public.get_company_effective_plan(NEW.company_id);
  IF FOUND AND v_effective.effective_limits IS NOT NULL THEN
    v_max := (v_effective.effective_limits ->> 'max_technicians')::integer;
    IF v_max IS NOT NULL AND v_max > 0 THEN
      SELECT count(*)::integer INTO v_current_count
        FROM public.technicians
       WHERE company_id = NEW.company_id AND is_active = true;

      IF v_current_count >= v_max THEN
        RAISE EXCEPTION 'Limite de técnicos do plano atingido (máximo permitido: %). Faça upgrade do seu plano para cadastrar mais técnicos.', v_max;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_technician_limit ON public.technicians;
CREATE TRIGGER trg_enforce_technician_limit
  BEFORE INSERT ON public.technicians
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_company_technician_limit();

-- 6.2 Limite de Usuários / Membros da Empresa
CREATE OR REPLACE FUNCTION public.trg_enforce_company_users_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective record;
  v_max integer;
  v_current_count integer;
BEGIN
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_effective FROM public.get_company_effective_plan(NEW.company_id);
  IF FOUND AND v_effective.effective_limits IS NOT NULL THEN
    v_max := (v_effective.effective_limits ->> 'max_users')::integer;
    IF v_max IS NOT NULL AND v_max > 0 THEN
      SELECT count(*)::integer INTO v_current_count
        FROM public.company_memberships
       WHERE company_id = NEW.company_id AND is_active = true;

      IF v_current_count >= v_max THEN
        RAISE EXCEPTION 'Limite de colaboradores do plano atingido (máximo permitido: %). Faça upgrade do seu plano para adicionar mais usuários.', v_max;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_users_limit ON public.company_memberships;
CREATE TRIGGER trg_enforce_users_limit
  BEFORE INSERT ON public.company_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_company_users_limit();

-- 6.3 Limite de Clientes
CREATE OR REPLACE FUNCTION public.trg_enforce_company_clients_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective record;
  v_max integer;
  v_current_count integer;
BEGIN
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_effective FROM public.get_company_effective_plan(NEW.company_id);
  IF FOUND AND v_effective.effective_limits IS NOT NULL THEN
    v_max := (v_effective.effective_limits ->> 'max_clients')::integer;
    IF v_max IS NOT NULL AND v_max > 0 THEN
      SELECT count(*)::integer INTO v_current_count
        FROM public.clients
       WHERE company_id = NEW.company_id AND is_active = true;

      IF v_current_count >= v_max THEN
        RAISE EXCEPTION 'Limite de clientes do plano atingido (máximo permitido: %). Faça upgrade do seu plano para cadastrar mais clientes.', v_max;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_clients_limit ON public.clients;
CREATE TRIGGER trg_enforce_clients_limit
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_company_clients_limit();

-- 6.4 Limite de Equipamentos (Balanças)
CREATE OR REPLACE FUNCTION public.trg_enforce_company_equipments_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective record;
  v_max integer;
  v_current_count integer;
BEGIN
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_effective FROM public.get_company_effective_plan(NEW.company_id);
  IF FOUND AND v_effective.effective_limits IS NOT NULL THEN
    v_max := (v_effective.effective_limits ->> 'max_equipments')::integer;
    IF v_max IS NOT NULL AND v_max > 0 THEN
      SELECT count(*)::integer INTO v_current_count
        FROM public.equipments
       WHERE company_id = NEW.company_id;

      IF v_current_count >= v_max THEN
        RAISE EXCEPTION 'Limite de balanças/equipamentos do plano atingido (máximo permitido: %). Faça upgrade do seu plano para cadastrar mais equipamentos.', v_max;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_equipments_limit ON public.equipments;
CREATE TRIGGER trg_enforce_equipments_limit
  BEFORE INSERT ON public.equipments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_company_equipments_limit();

-- ----------------------------------------------------------------------------
-- 7. SEED DOS PLANOS OFICIAIS METRION E ATRIBUIÇÃO INICIAL
-- ----------------------------------------------------------------------------
INSERT INTO public.plans (
  name, slug, description, price, billing_cycle, trial_days, is_active, is_public, sort_order,
  max_technicians, max_users, max_clients, max_equipments, max_storage_mb, max_monthly_os, features
) VALUES
(
  'Metrion Essencial',
  'essencial',
  'Para assistências técnicas de pequeno porte em início de digitalização.',
  197.00,
  'monthly',
  14,
  true,
  true,
  1,
  3,
  5,
  150,
  300,
  1024,
  60,
  '{
    "stock": false,
    "multi_scale_os": true,
    "gps_routing": true,
    "pdf_reports": true,
    "signatures": true,
    "photos": true,
    "custom_logo": false,
    "api_access": false
  }'::jsonb
),
(
  'Metrion Profissional',
  'profissional',
  'Plano completo para empresas em expansão com estoque integrado e múltiplos técnicos.',
  397.00,
  'monthly',
  14,
  true,
  true,
  2,
  15,
  25,
  1500,
  3500,
  5120,
  400,
  '{
    "stock": true,
    "multi_scale_os": true,
    "gps_routing": true,
    "pdf_reports": true,
    "signatures": true,
    "photos": true,
    "custom_logo": true,
    "api_access": false
  }'::jsonb
),
(
  'Metrion Enterprise',
  'enterprise',
  'Estrutura de alta capacidade para redes regionais e operações industriais sem limites de técnicos.',
  897.00,
  'monthly',
  0,
  true,
  true,
  3,
  NULL,
  NULL,
  NULL,
  NULL,
  51200,
  NULL,
  '{
    "stock": true,
    "multi_scale_os": true,
    "gps_routing": true,
    "pdf_reports": true,
    "signatures": true,
    "photos": true,
    "custom_logo": true,
    "api_access": true
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  features = EXCLUDED.features,
  max_technicians = EXCLUDED.max_technicians,
  max_users = EXCLUDED.max_users,
  max_clients = EXCLUDED.max_clients,
  max_equipments = EXCLUDED.max_equipments,
  updated_at = now();

-- Atribui plano Profissional como padrão para empresas já existentes sem assinatura
INSERT INTO public.subscriptions (company_id, plan_id, status, notes)
SELECT c.id, p.id, 'active', 'Ativação automática de transição V2'
FROM public.companies c
CROSS JOIN (SELECT id FROM public.plans WHERE slug = 'profissional' LIMIT 1) p
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s WHERE s.company_id = c.id
)
ON CONFLICT (company_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 8. POLÍTICAS DE ROW LEVEL SECURITY (RLS) E PERMISSÕES
-- ----------------------------------------------------------------------------
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_plan_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_audit_logs ENABLE ROW LEVEL SECURITY;

-- 8.1 plans (Super Admin gerencia; usuários autenticados consultam)
DROP POLICY IF EXISTS plans_select_policy ON public.plans;
CREATE POLICY plans_select_policy ON public.plans
  FOR SELECT TO authenticated
  USING (is_public = true OR public.is_platform_admin());

DROP POLICY IF EXISTS plans_admin_policy ON public.plans;
CREATE POLICY plans_admin_policy ON public.plans
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 8.2 subscriptions (Super Admin gerencia; membro da empresa consulta)
DROP POLICY IF EXISTS subscriptions_select_policy ON public.subscriptions;
CREATE POLICY subscriptions_select_policy ON public.subscriptions
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS subscriptions_admin_policy ON public.subscriptions;
CREATE POLICY subscriptions_admin_policy ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 8.3 company_plan_overrides (Super Admin gerencia; membro consulta)
DROP POLICY IF EXISTS overrides_select_policy ON public.company_plan_overrides;
CREATE POLICY overrides_select_policy ON public.company_plan_overrides
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS overrides_admin_policy ON public.company_plan_overrides;
CREATE POLICY overrides_admin_policy ON public.company_plan_overrides
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 8.4 plan_audit_logs
DROP POLICY IF EXISTS plan_audit_select_policy ON public.plan_audit_logs;
CREATE POLICY plan_audit_select_policy ON public.plan_audit_logs
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR (company_id IS NOT NULL AND public.is_company_manager(company_id))
  );

DROP POLICY IF EXISTS plan_audit_insert_policy ON public.plan_audit_logs;
CREATE POLICY plan_audit_insert_policy ON public.plan_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

GRANT SELECT ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT SELECT ON TABLE public.company_plan_overrides TO authenticated;
GRANT ALL ON TABLE public.company_plan_overrides TO authenticated;
GRANT SELECT, INSERT ON TABLE public.plan_audit_logs TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_company_effective_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_company_feature_enabled(uuid, text) TO authenticated;

COMMIT;
