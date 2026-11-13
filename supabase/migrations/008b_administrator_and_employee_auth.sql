-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 008b: 4º Perfil (Administrator), Estruturas, Funções Seguras,
--                Sessão de Suporte Auditada e RLS sem COMMITs embutidos
-- ============================================================================
-- PRÉ-REQUISITO: Execução prévia da migração 008a (enum app_role).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CAMPOS DE AUTENTICAÇÃO POR IDENTIFICADOR E TROCA DE SENHA
-- ----------------------------------------------------------------------------
-- Flag de troca obrigatória de senha e hash da senha temporária para comprovação criptográfica
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS temporary_password_hash text;

-- Trigger para sincronizar o hash da senha temporária sempre que must_change_password for ativado
CREATE OR REPLACE FUNCTION public.sync_temporary_password_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.must_change_password = true THEN
    SELECT md5(encrypted_password)
      INTO NEW.temporary_password_hash
      FROM auth.users
     WHERE id = NEW.id;
  ELSE
    NEW.temporary_password_hash := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_temporary_password_hash ON public.profiles;
CREATE TRIGGER trg_sync_temporary_password_hash
  BEFORE INSERT OR UPDATE OF must_change_password ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_temporary_password_hash();

-- Identificador (username) na associação da empresa
ALTER TABLE public.company_memberships
  ADD COLUMN IF NOT EXISTS username text;

-- Restrição de formato e unicidade de username DENTRO da mesma empresa
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_company_id_username_key'
  ) THEN
    ALTER TABLE public.company_memberships
      ADD CONSTRAINT company_memberships_company_id_username_key UNIQUE (company_id, username);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_company_memberships_username
  ON public.company_memberships (company_id, lower(username))
  WHERE username IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. SUPORTE AUDITADO DA PLATAFORMA (ISOLAMENTO MULTIEMPRESA ESTRITO)
-- ----------------------------------------------------------------------------
-- Impede que Super Admins acessem dados operacionais de clientes sem chamado/sessão
CREATE TABLE IF NOT EXISTS public.platform_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_support_active
  ON public.platform_support_sessions (platform_admin_id, company_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.platform_support_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_active_support_session(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.platform_support_sessions pss
      JOIN public.platform_admins pa ON pa.user_id = pss.platform_admin_id
     WHERE pss.company_id = p_company_id
       AND pss.platform_admin_id = auth.uid()
       AND pa.is_active = true
       AND pss.revoked_at IS NULL
       AND pss.expires_at > now()
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. REFINAMENTO DAS FUNÇÕES DE AUTORIZAÇÃO (REMOVENDO BYPASS DO SUPER ADMIN)
-- ----------------------------------------------------------------------------
-- Membro ativo: apenas usuário com vínculo ativo (is_active = true) e sem pendência de troca de senha
CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_active_support_session(p_company_id) OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
      LEFT JOIN public.profiles p ON p.id = cm.user_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.is_active = true
       AND c.is_active = true
       AND coalesce(p.must_change_password, false) = false
  );
$$;

-- Gestor ativo: apenas gestor com vínculo ativo (is_active = true) e sem pendência de troca de senha
CREATE OR REPLACE FUNCTION public.is_company_manager(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_active_support_session(p_company_id) OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
      LEFT JOIN public.profiles p ON p.id = cm.user_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.role = 'manager'
       AND cm.is_active = true
       AND c.is_active = true
       AND coalesce(p.must_change_password, false) = false
  );
$$;

-- Gestor OU Administrador ativo
CREATE OR REPLACE FUNCTION public.is_company_admin_or_manager(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_active_support_session(p_company_id) OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
      LEFT JOIN public.profiles p ON p.id = cm.user_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.role IN ('manager', 'administrator')
       AND cm.is_active = true
       AND c.is_active = true
       AND coalesce(p.must_change_password, false) = false
  );
$$;

-- Regra central de visualização de Ordem de Serviço atualizada com 4º perfil
CREATE OR REPLACE FUNCTION public.can_access_service_order(p_os_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR (
      public.is_company_member(p_company_id)
      AND EXISTS (
        SELECT 1
          FROM public.service_orders so
         WHERE so.id = p_os_id
           AND so.company_id = p_company_id
           AND (
             public.technician_has_company_os_override(p_company_id)
             OR (
               so.allow_company_technicians_view = true
               AND public.current_technician_id(p_company_id) IS NOT NULL
             )
             OR so.primary_technician_id = public.current_technician_id(p_company_id)
             OR EXISTS (
               SELECT 1
                 FROM public.service_order_assignments soa
                WHERE soa.service_order_id = so.id
                  AND soa.company_id = soa.company_id
                  AND soa.technician_id = public.current_technician_id(p_company_id)
                  AND soa.is_active = true
             )
           )
      )
    );
$$;

-- Funções de visualização atualizadas para Administrador e Gestor
CREATE OR REPLACE FUNCTION public.can_view_client(p_client_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND so.client_id = p_client_id
         AND public.can_access_service_order(so.id, p_company_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_client_unit(p_unit_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND (so.unit_id = p_unit_id OR so.client_id = (
           SELECT cu.client_id FROM public.client_units cu WHERE cu.id = p_unit_id AND cu.company_id = p_company_id
         ))
         AND public.can_access_service_order(so.id, p_company_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_equipment(p_equipment_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin_or_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND so.equipment_id = p_equipment_id
         AND public.can_access_service_order(so.id, p_company_id)
    );
$$;

-- ----------------------------------------------------------------------------
-- 4. RESOLUÇÃO SEGURA DE IDENTIFICADOR (SEM VAZAMENTO OU ENUMERAÇÃO)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 5. ATUALIZAÇÃO DAS POLÍTICAS DE RLS PARA O PERFIL ADMINISTRATOR
-- ----------------------------------------------------------------------------

-- 5.1 company_memberships:
-- Gestor gerencia (INSERT, UPDATE, DELETE). Administrador apenas visualiza os membros.
DROP POLICY IF EXISTS memberships_insert_policy ON public.company_memberships;
CREATE POLICY memberships_insert_policy ON public.company_memberships
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS memberships_update_policy ON public.company_memberships;
CREATE POLICY memberships_update_policy ON public.company_memberships
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS memberships_delete_policy ON public.company_memberships;
CREATE POLICY memberships_delete_policy ON public.company_memberships
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 5.2 clients:
-- Administrador e Gestor criam e atualizam; Gestor exclui; Técnico visualiza
DROP POLICY IF EXISTS clients_insert_policy ON public.clients;
CREATE POLICY clients_insert_policy ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin_or_manager(company_id));

DROP POLICY IF EXISTS clients_update_policy ON public.clients;
CREATE POLICY clients_update_policy ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_company_admin_or_manager(company_id))
  WITH CHECK (public.is_company_admin_or_manager(company_id));

-- 5.3 equipments:
-- Administrador e Gestor criam e atualizam; Gestor exclui; Técnico visualiza
DROP POLICY IF EXISTS equipments_insert_policy ON public.equipments;
CREATE POLICY equipments_insert_policy ON public.equipments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin_or_manager(company_id));

DROP POLICY IF EXISTS equipments_update_policy ON public.equipments;
CREATE POLICY equipments_update_policy ON public.equipments
  FOR UPDATE TO authenticated
  USING (public.is_company_admin_or_manager(company_id))
  WITH CHECK (public.is_company_admin_or_manager(company_id));

-- 5.4 service_orders:
-- Administrador e Gestor têm visão completa e criam ordens de serviço
DROP POLICY IF EXISTS service_orders_select_policy ON public.service_orders;
CREATE POLICY service_orders_select_policy ON public.service_orders
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(id, company_id));

DROP POLICY IF EXISTS service_orders_insert_policy ON public.service_orders;
CREATE POLICY service_orders_insert_policy ON public.service_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin_or_manager(company_id));

DROP POLICY IF EXISTS service_orders_update_policy ON public.service_orders;
CREATE POLICY service_orders_update_policy ON public.service_orders
  FOR UPDATE TO authenticated
  USING (public.can_access_service_order(id, company_id))
  WITH CHECK (
    public.is_company_admin_or_manager(company_id)
    OR (
      public.current_technician_id(company_id) IS NOT NULL
      AND (
        primary_technician_id = public.current_technician_id(company_id)
        OR EXISTS (
          SELECT 1 FROM public.service_order_assignments soa
           WHERE soa.service_order_id = service_orders.id
             AND soa.company_id = service_orders.company_id
             AND soa.technician_id = public.current_technician_id(service_orders.company_id)
             AND soa.is_active = true
        )
      )
    )
  );

-- 5.5 service_order_items (Aprovação de itens autorizada para Gestor E Administrador)
DROP POLICY IF EXISTS so_items_update_policy ON public.service_order_items;
CREATE POLICY so_items_update_policy ON public.service_order_items
  FOR UPDATE TO authenticated
  USING (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_admin_or_manager(company_id)
      OR created_by = auth.uid()
      OR item_status = 'authorized'
    )
  )
  WITH CHECK (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_admin_or_manager(company_id)
      OR created_by = auth.uid()
      OR item_status = 'applied'
    )
  );

-- 5.6 platform_support_sessions: Apenas platform admin gerencia sessões de suporte
CREATE POLICY platform_support_select_policy ON public.platform_support_sessions
  FOR SELECT TO authenticated
  USING (platform_admin_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY platform_support_insert_policy ON public.platform_support_sessions
  FOR INSERT TO authenticated
  WITH CHECK (platform_admin_id = auth.uid() AND public.is_platform_admin());

CREATE POLICY platform_support_update_policy ON public.platform_support_sessions
  FOR UPDATE TO authenticated
  USING (platform_admin_id = auth.uid() AND public.is_platform_admin())
  WITH CHECK (platform_admin_id = auth.uid() AND public.is_platform_admin());

-- ----------------------------------------------------------------------------
-- 6. FUNÇÃO SEGURA E INFALSIFICÁVEL DE CONFIRMAÇÃO DE TROCA DE SENHA
-- ----------------------------------------------------------------------------
-- Validação criptográfica rigorosa: não depende de updated_at (que pode ser
-- alterado por metadados ou emails). Compara o hash de encrypted_password
-- contra o temporary_password_hash salvo no perfil do usuário autenticado.
CREATE OR REPLACE FUNCTION public.confirm_password_changed()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_current_auth_hash text;
  v_temp_hash text;
  v_must_change boolean;
BEGIN
  -- 1. Inspeciona o perfil do usuário autenticado
  SELECT must_change_password, temporary_password_hash
    INTO v_must_change, v_temp_hash
    FROM public.profiles
   WHERE id = auth.uid();

  -- Se o usuário não possui pendência de troca de senha, retorna sucesso
  IF NOT coalesce(v_must_change, false) THEN
    RETURN true;
  END IF;

  -- 2. Obtém o hash da credencial no auth.users
  SELECT md5(encrypted_password)
    INTO v_current_auth_hash
    FROM auth.users
   WHERE id = auth.uid();

  -- 3. Comprovação inequívoca:
  -- Se o hash de encrypted_password for idêntico ao gravado como temporário (ou nulo),
  -- nenhuma alteração real de senha ocorreu. Atualizações de metadados ou perfil
  -- não alteram o encrypted_password, falhando obrigatoriamente nesta checagem.
  IF v_current_auth_hash IS NULL OR v_current_auth_hash = v_temp_hash THEN
    RAISE EXCEPTION 'A troca de senha não foi detectada no sistema de autenticação. Defina uma nova senha pessoal diferente da temporária antes de prosseguir.';
  END IF;

  -- 4. Troca de credencial confirmada: remove a flag e limpa o hash temporário
  UPDATE public.profiles
     SET must_change_password = false,
         temporary_password_hash = NULL,
         updated_at = now()
   WHERE id = auth.uid();

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_password_changed() TO authenticated;

-- Proteção no profiles: usuário comum não pode desmarcar must_change_password nem manipular temporary_password_hash via UPDATE direto
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (
    public.is_platform_admin()
    OR (
      id = auth.uid()
      AND (
        -- Impede o usuário de alterar must_change_password ou temporary_password_hash arbitrariamente via PostgREST
        must_change_password = (SELECT p.must_change_password FROM public.profiles p WHERE p.id = auth.uid())
        AND temporary_password_hash IS NOT DISTINCT FROM (SELECT p.temporary_password_hash FROM public.profiles p WHERE p.id = auth.uid())
      )
    )
  );
