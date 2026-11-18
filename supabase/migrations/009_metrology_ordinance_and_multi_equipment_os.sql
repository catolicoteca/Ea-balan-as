-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 009: Portaria Inmetro/Dimel, Múltiplas Balanças com Integridade Estrita
--                no Banco, Troca Segura de Senha e Rate Limiting no Servidor
-- ============================================================================
-- Dependências: Migrações 001, 003 e 008b já aplicadas.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. CAMPO FORMAL DE PORTARIA INMETRO / DIMEL NA BALANÇA
-- ----------------------------------------------------------------------------
ALTER TABLE public.equipments
  ADD COLUMN IF NOT EXISTS inmetro_ordinance text;

-- ----------------------------------------------------------------------------
-- 2. TABELA ASSOCIATIVA: MÚLTIPLAS BALANÇAS POR ORDEM DE SERVIÇO
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_order_equipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipments(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_so_equipment UNIQUE (service_order_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_so_equipments_company
  ON public.service_order_equipments(company_id);

CREATE INDEX IF NOT EXISTS idx_so_equipments_so
  ON public.service_order_equipments(service_order_id);

CREATE INDEX IF NOT EXISTS idx_so_equipments_equipment
  ON public.service_order_equipments(equipment_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_so_equipment') THEN
    ALTER TABLE public.service_order_equipments
      ADD CONSTRAINT uq_so_equipment UNIQUE (service_order_id, equipment_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. TRIGGER DE INTEGRIDADE ESTRITA NO BANCO (ANTI CROSS-TENANT E CROSS-CLIENT)
-- Garante no motor do banco que OS, balança e company_id pertencem à mesma empresa
-- E que a balança pertence exatamente ao cliente da Ordem de Serviço.
-- Não depende de RLS nem de validações na interface.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_service_order_equipment_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_so_company_id uuid;
  v_so_client_id uuid;
  v_eq_company_id uuid;
  v_eq_client_id uuid;
BEGIN
  -- 1. Obter empresa e cliente da Ordem de Serviço
  SELECT company_id, client_id
    INTO v_so_company_id, v_so_client_id
    FROM public.service_orders
   WHERE id = NEW.service_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço % não encontrada.', NEW.service_order_id;
  END IF;

  -- 2. Obter empresa e cliente da Balança/Equipamento
  SELECT company_id, client_id
    INTO v_eq_company_id, v_eq_client_id
    FROM public.equipments
   WHERE id = NEW.equipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balança/equipamento % não encontrado.', NEW.equipment_id;
  END IF;

  -- 3. Validação de isolamento multiempresa estrito (Anti Cross-tenant)
  IF NEW.company_id <> v_so_company_id OR NEW.company_id <> v_eq_company_id THEN
    RAISE EXCEPTION 'Inconsistência multiempresa: a OS (empresa %), a balança (empresa %) e o vínculo (empresa %) devem pertencer à mesma empresa.',
      v_so_company_id, v_eq_company_id, NEW.company_id;
  END IF;

  -- 4. Validação de compatibilidade com o cliente da OS (Anti Cross-client)
  IF v_eq_client_id IS DISTINCT FROM v_so_client_id THEN
    RAISE EXCEPTION 'Inconsistência de cliente: a balança pertence ao cliente %, enquanto a Ordem de Serviço foi aberta para o cliente %.',
      v_eq_client_id, v_so_client_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_service_order_equipment_integrity ON public.service_order_equipments;
CREATE TRIGGER trg_validate_service_order_equipment_integrity
  BEFORE INSERT OR UPDATE ON public.service_order_equipments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_service_order_equipment_integrity();

-- ----------------------------------------------------------------------------
-- 4. POLÍTICAS DE ROW LEVEL SECURITY (RLS) MULTI-TENANT EM service_order_equipments
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_order_equipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS so_equipments_select_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_select_policy ON public.service_order_equipments
  FOR SELECT TO authenticated
  USING (
    public.can_access_service_order(service_order_id, company_id)
    AND public.can_view_equipment(equipment_id, company_id)
  );

DROP POLICY IF EXISTS so_equipments_insert_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_insert_policy ON public.service_order_equipments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_service_order(service_order_id, company_id)
    AND public.can_view_equipment(equipment_id, company_id)
  );

DROP POLICY IF EXISTS so_equipments_update_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_update_policy ON public.service_order_equipments
  FOR UPDATE TO authenticated
  USING (
    public.can_access_service_order(service_order_id, company_id)
    AND public.can_view_equipment(equipment_id, company_id)
  )
  WITH CHECK (
    public.can_access_service_order(service_order_id, company_id)
    AND public.can_view_equipment(equipment_id, company_id)
  );

DROP POLICY IF EXISTS so_equipments_delete_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_delete_policy ON public.service_order_equipments
  FOR DELETE TO authenticated
  USING (public.is_company_admin_or_manager(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_order_equipments TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. PROTEÇÃO CONTRA TENTATIVAS EXCESSIVAS DE LOGIN NO SERVIDOR (RATE LIMITING)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier_key text NOT NULL UNIQUE,
  failed_attempts integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_key
  ON public.auth_rate_limits (identifier_key);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

-- 5.1 Função de registro de falha e bloqueio no servidor
CREATE OR REPLACE FUNCTION public.record_login_failure(p_company_slug text, p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_rec record;
  v_max_attempts constant integer := 5;
  v_window_interval constant interval := interval '15 minutes';
  v_lockout_interval constant interval := interval '15 minutes';
  v_now timestamptz := now();
  v_locked boolean := false;
  v_locked_until timestamptz := NULL;
  v_remaining integer;
BEGIN
  v_key := lower(btrim(coalesce(p_company_slug, ''))) || ':' || lower(btrim(coalesce(p_username, '')));
  IF v_key = ':' THEN
    RETURN jsonb_build_object('error', 'Identificador inválido');
  END IF;

  SELECT * INTO v_rec FROM public.auth_rate_limits WHERE identifier_key = v_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.auth_rate_limits (identifier_key, failed_attempts, first_failed_at, last_failed_at)
    VALUES (v_key, 1, v_now, v_now)
    RETURNING * INTO v_rec;
  ELSE
    -- Se o bloqueio anterior já expirou, reinicia a contagem
    IF v_rec.locked_until IS NOT NULL AND v_rec.locked_until <= v_now THEN
      v_rec.failed_attempts := 0;
      v_rec.locked_until := NULL;
      v_rec.first_failed_at := v_now;
    -- Se a janela de 15 minutos expirou desde a primeira falha, reinicia
    ELSIF v_rec.locked_until IS NULL AND (v_now - v_rec.first_failed_at) > v_window_interval THEN
      v_rec.failed_attempts := 0;
      v_rec.first_failed_at := v_now;
    END IF;

    v_rec.failed_attempts := v_rec.failed_attempts + 1;
    v_rec.last_failed_at := v_now;

    IF v_rec.failed_attempts >= v_max_attempts THEN
      v_rec.locked_until := v_now + v_lockout_interval;
      v_locked := true;
      v_locked_until := v_rec.locked_until;
    END IF;

    UPDATE public.auth_rate_limits
       SET failed_attempts = v_rec.failed_attempts,
           first_failed_at = v_rec.first_failed_at,
           last_failed_at = v_rec.last_failed_at,
           locked_until = v_rec.locked_until
     WHERE identifier_key = v_key;
  END IF;

  v_locked := (v_rec.locked_until IS NOT NULL AND v_rec.locked_until > v_now);
  v_remaining := GREATEST(0, v_max_attempts - v_rec.failed_attempts);

  RETURN jsonb_build_object(
    'locked', v_locked,
    'failed_attempts', v_rec.failed_attempts,
    'remaining_attempts', v_remaining,
    'locked_until', v_rec.locked_until
  );
END;
$$;

-- 5.2 Função de sucesso e limpeza de bloqueio
CREATE OR REPLACE FUNCTION public.record_login_success(p_company_slug text, p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := lower(btrim(coalesce(p_company_slug, ''))) || ':' || lower(btrim(coalesce(p_username, '')));
  IF v_key = ':' THEN
    RETURN false;
  END IF;

  DELETE FROM public.auth_rate_limits WHERE identifier_key = v_key;
  RETURN true;
END;
$$;

-- 5.3 Atualização de resolve_employee_identifier com bloqueio ativo no servidor
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
  v_key text;
  v_lock_rec record;
BEGIN
  v_clean_slug := lower(btrim(coalesce(p_company_slug, '')));
  v_clean_user := lower(btrim(coalesce(p_username, '')));
  v_key := v_clean_slug || ':' || v_clean_user;

  IF v_clean_slug = '' OR v_clean_user = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Checagem de Rate Limit no servidor: rejeita caso a conta esteja temporariamente bloqueada
  SELECT locked_until INTO v_lock_rec
    FROM public.auth_rate_limits
   WHERE identifier_key = v_key;

  IF FOUND AND v_lock_rec.locked_until IS NOT NULL AND v_lock_rec.locked_until > now() THEN
    RETURN jsonb_build_object(
      'found', false,
      'locked', true,
      'locked_until', v_lock_rec.locked_until,
      'error', 'Muitas tentativas incorretas de autenticação. Acesso temporariamente bloqueado por 15 minutos por segurança.'
    );
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
    -- Registra tentativa malsucedida no servidor para evitar varredura contínua de usuários
    PERFORM public.record_login_failure(v_clean_slug, v_clean_user);
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

GRANT EXECUTE ON FUNCTION public.record_login_failure(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_success(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_employee_identifier(text, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. REVISÃO DO FLUXO DE TROCA OBRIGATÓRIA DE SENHA SEM auth.users.encrypted_password
-- Remove qualquer dependência de leitura da coluna privada encrypted_password.
-- Utiliza confirmação criptográfica por ticket/servidor e autorização service_role.
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_change_ticket uuid;

-- Remove o trigger legado que lia auth.users.encrypted_password
DROP TRIGGER IF EXISTS trg_sync_temporary_password_hash ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_temporary_password_hash();

-- Atualiza a função confirm_password_changed sem inspecionar auth.users
CREATE OR REPLACE FUNCTION public.confirm_password_changed(p_ticket uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_must_change boolean;
  v_stored_ticket uuid;
BEGIN
  SELECT must_change_password, password_change_ticket
    INTO v_must_change, v_stored_ticket
    FROM public.profiles
   WHERE id = auth.uid();

  IF NOT coalesce(v_must_change, false) THEN
    RETURN true;
  END IF;

  -- Se for invocado sem o ticket de troca do servidor ou com ticket inválido
  IF p_ticket IS NULL OR v_stored_ticket IS NULL OR p_ticket <> v_stored_ticket THEN
    RAISE EXCEPTION 'A confirmação de troca de senha exige validação prévia pelo servidor ou ticket criptográfico válido.';
  END IF;

  UPDATE public.profiles
     SET must_change_password = false,
         password_change_ticket = NULL,
         updated_at = now()
   WHERE id = auth.uid();

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_password_changed(uuid) TO authenticated;

-- Hardening no profiles: impede alteração manual de must_change_password via PostgREST
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (
    public.is_platform_admin()
    OR (
      id = auth.uid()
      AND (
        must_change_password = (SELECT p.must_change_password FROM public.profiles p WHERE p.id = auth.uid())
      )
    )
  );

COMMIT;
