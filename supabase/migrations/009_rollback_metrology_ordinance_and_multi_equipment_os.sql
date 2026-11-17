-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Rollback da Migração 009: Portaria Inmetro/Dimel, Múltiplas Balanças,
--                           Rate Limiting e Revisão de Troca de Senha
-- ============================================================================

BEGIN;

-- 1. Remove RLS e tabela de múltiplas balanças por OS
DROP POLICY IF EXISTS so_equipments_delete_policy ON public.service_order_equipments;
DROP POLICY IF EXISTS so_equipments_update_policy ON public.service_order_equipments;
DROP POLICY IF EXISTS so_equipments_insert_policy ON public.service_order_equipments;
DROP POLICY IF EXISTS so_equipments_select_policy ON public.service_order_equipments;

DROP TRIGGER IF EXISTS trg_validate_service_order_equipment_integrity ON public.service_order_equipments;
DROP FUNCTION IF EXISTS public.validate_service_order_equipment_integrity();

DROP TABLE IF EXISTS public.service_order_equipments CASCADE;

-- 2. Remove campo de portaria na balança
ALTER TABLE public.equipments
  DROP COLUMN IF EXISTS inmetro_ordinance;

-- 3. Remove estruturas de rate limiting
DROP FUNCTION IF EXISTS public.record_login_success(text, text);
DROP FUNCTION IF EXISTS public.record_login_failure(text, text);
DROP TABLE IF EXISTS public.auth_rate_limits CASCADE;

-- 4. Restaura versão padrão de resolve_employee_identifier (sem rate limiting)
CREATE OR REPLACE FUNCTION public.resolve_employee_identifier(p_company_slug text, p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_email text;
  v_is_active boolean;
  v_must_change boolean;
  v_clean_slug text;
  v_clean_user text;
BEGIN
  v_clean_slug := lower(btrim(coalesce(p_company_slug, '')));
  v_clean_user := lower(btrim(coalesce(p_username, '')));

  IF v_clean_slug = '' OR v_clean_user = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT u.email, cm.is_active, coalesce(p.must_change_password, false)
    INTO v_user_email, v_is_active, v_must_change
    FROM public.company_memberships cm
    JOIN public.companies c ON c.id = cm.company_id
    JOIN auth.users u ON u.id = cm.user_id
    LEFT JOIN public.profiles p ON p.id = cm.user_id
   WHERE lower(c.slug) = v_clean_slug
     AND lower(cm.username) = v_clean_user
     AND c.is_active = true
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object(
      'found', true,
      'is_active', false,
      'error', 'Esta conta de colaborador foi desativada pela administração da empresa.'
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'is_active', true,
    'email', v_user_email,
    'must_change_password', v_must_change
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_employee_identifier(text, text) TO anon, authenticated;

-- 5. Remove ticket de troca de senha no profiles
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS password_change_ticket;

COMMIT;
