-- ============================================================================
-- METRION SAAS V2 — SCRIPT CONSOLIDADO DE MIGRAÇÕES (009 + 010a + 010b)
-- Ambiente Alvo: metrion-staging (Supabase)
-- Conteúdo:
--   1. Migração 009: Portaria Inmetro/Dimel, Múltiplas Balanças por OS, Validação
--                   Estrita no Banco, Troca Segura de Senha e Rate Limiting no Servidor
--   2. Migração 010a: Adição do valor 'stock_manager' ao enum app_role (Fora de transação)
--   3. Migração 010b: Estoque Central e Veículos, Baixa Automática em OS, Alertas e RLS
-- ============================================================================

-- ============================================================================
-- PARTE 1 / 3: MIGRAÇÃO 009 (TRANSAÇÃO 1)
-- ============================================================================

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

-- ============================================================================
-- PARTE 2 / 3: MIGRAÇÃO 010a (DDL DE CATÁLOGO FORA DE BLOCO DE TRANSAÇÃO)
-- ============================================================================

-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 010a: Adição do valor 'stock_manager' ao enum app_role
-- ============================================================================
-- Isolada sem transação interna para atualização segura do catálogo PostgreSQL
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'stock_manager';

-- ============================================================================
-- PARTE 3 / 3: MIGRAÇÃO 010b (TRANSAÇÃO 2)
-- ============================================================================

-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 010b: Módulo Completo de Estoque (Central e por Técnico),
--                Baixa Automática na OS, Alertas e Perfil de Responsável
-- ============================================================================
-- Pré-requisito: Execução da etapa 010a (enum app_role com 'stock_manager').
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURA DE LOCAIS DE ESTOQUE (CENTRAL E MÓVEL POR TÉCNICO)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) >= 2),
  location_type text NOT NULL CHECK (location_type IN ('central', 'technician', 'warehouse', 'vehicle')),
  technician_id uuid REFERENCES public.technicians(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_location_name UNIQUE (company_id, name),
  CONSTRAINT uq_company_tech_location UNIQUE (company_id, technician_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_locations_company
  ON public.stock_locations(company_id);

CREATE INDEX IF NOT EXISTS idx_stock_locations_tech
  ON public.stock_locations(technician_id)
  WHERE technician_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. SALDOS DE ITENS EM ESTOQUE (POR LOCAL E ITEM)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  catalog_item_id uuid REFERENCES public.price_catalog_items(id) ON DELETE SET NULL,
  item_code text NOT NULL CHECK (char_length(btrim(item_code)) >= 1),
  name text NOT NULL CHECK (char_length(btrim(name)) >= 2),
  category text,
  unit_of_measure text NOT NULL DEFAULT 'UN',
  quantity numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (quantity >= 0),
  min_quantity numeric(12, 2) NOT NULL DEFAULT 2.00 CHECK (min_quantity >= 0),
  unit_cost numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (unit_cost >= 0),
  unit_price numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
  shelf_location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_location_item_code UNIQUE (location_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_lookup
  ON public.inventory_items(company_id, location_id, item_code);

CREATE INDEX IF NOT EXISTS idx_inventory_items_low_stock
  ON public.inventory_items(company_id, location_id)
  WHERE quantity <= min_quantity;

-- ----------------------------------------------------------------------------
-- 3. MOVIMENTAÇÕES DE ESTOQUE (ENTRADAS, TRANSFERÊNCIAS, BAIXAS POR OS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (
    movement_type IN ('entry', 'transfer_out', 'transfer_in', 'consumption', 'adjustment_positive', 'adjustment_negative')
  ),
  source_location_id uuid REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  destination_location_id uuid REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  catalog_item_id uuid REFERENCES public.price_catalog_items(id) ON DELETE SET NULL,
  item_code text NOT NULL,
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (unit_cost >= 0),
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  service_order_item_id uuid REFERENCES public.service_order_items(id) ON DELETE SET NULL,
  technician_id uuid REFERENCES public.technicians(id) ON DELETE SET NULL,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invoice_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Prevenção inequívoca de baixas duplicadas para o mesmo item de Ordem de Serviço
  CONSTRAINT uq_so_item_movement UNIQUE (service_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_company
  ON public.stock_movements(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_so
  ON public.stock_movements(service_order_id)
  WHERE service_order_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. FUNÇÕES DE AUTORIZAÇÃO E SUPORTE AO NOVO PERFIL DE ESTOQUE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_company_stock_manager(p_company_id uuid)
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
       AND cm.role::text IN ('manager', 'administrator', 'stock_manager')
       AND cm.is_active = true
       AND c.is_active = true
       AND coalesce(p.must_change_password, false) = false
  );
$$;

-- Atualização de is_company_member para incluir stock_manager
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

-- ----------------------------------------------------------------------------
-- 5. PROCEDURES E FUNÇÕES DE PROCESSAMENTO DE ESTOQUE
-- ----------------------------------------------------------------------------

-- 5.1 Entrada de Estoque (compras / reposição) com recálculo de custo médio
CREATE OR REPLACE FUNCTION public.process_stock_entry(
  p_company_id uuid,
  p_location_id uuid,
  p_catalog_item_id uuid,
  p_item_code text,
  p_name text,
  p_category text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_invoice_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_id uuid;
  v_current_qty numeric := 0;
  v_current_cost numeric := 0;
  v_new_qty numeric;
  v_new_avg_cost numeric;
  v_movement_id uuid;
BEGIN
  IF NOT public.is_company_stock_manager(p_company_id) THEN
    RAISE EXCEPTION 'Acesso não autorizado: usuário não possui permissão de gestão de estoque nesta empresa.';
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'A quantidade de entrada deve ser maior que zero.';
  END IF;

  -- 1. Bloqueia ou obtém saldo atual
  SELECT id, quantity, unit_cost
    INTO v_item_id, v_current_qty, v_current_cost
    FROM public.inventory_items
   WHERE company_id = p_company_id
     AND location_id = p_location_id
     AND lower(item_code) = lower(btrim(p_item_code))
   FOR UPDATE;

  IF FOUND THEN
    v_new_qty := v_current_qty + p_quantity;
    -- Recálculo de Custo Médio Ponderado
    IF v_new_qty > 0 THEN
      v_new_avg_cost := round(((v_current_qty * v_current_cost) + (p_quantity * p_unit_cost)) / v_new_qty, 2);
    ELSE
      v_new_avg_cost := p_unit_cost;
    END IF;

    UPDATE public.inventory_items
       SET quantity = v_new_qty,
           unit_cost = v_new_avg_cost,
           catalog_item_id = coalesce(p_catalog_item_id, catalog_item_id),
           updated_at = now()
     WHERE id = v_item_id;
  ELSE
    INSERT INTO public.inventory_items (
      company_id, location_id, catalog_item_id, item_code, name, category, quantity, unit_cost
    ) VALUES (
      p_company_id, p_location_id, p_catalog_item_id, btrim(p_item_code), btrim(p_name), p_category, p_quantity, p_unit_cost
    )
    RETURNING id INTO v_item_id;
  END IF;

  -- 2. Registra o movimento de entrada
  INSERT INTO public.stock_movements (
    company_id, movement_type, destination_location_id, catalog_item_id, item_code,
    quantity, unit_cost, performed_by, invoice_number, notes
  ) VALUES (
    p_company_id, 'entry', p_location_id, p_catalog_item_id, btrim(p_item_code),
    p_quantity, p_unit_cost, auth.uid(), p_invoice_number, p_notes
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

-- 5.2 Transferência entre Locais (ex: Almoxarifado Central -> Estoque Móvel do Técnico)
CREATE OR REPLACE FUNCTION public.process_stock_transfer(
  p_company_id uuid,
  p_source_location_id uuid,
  p_dest_location_id uuid,
  p_item_code text,
  p_quantity numeric,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_item record;
  v_dest_item record;
BEGIN
  IF NOT public.is_company_stock_manager(p_company_id) THEN
    RAISE EXCEPTION 'Acesso não autorizado: usuário não possui permissão de gestão de estoque nesta empresa.';
  END IF;

  IF p_source_location_id = p_dest_location_id THEN
    RAISE EXCEPTION 'O local de origem e destino da transferência não podem ser iguais.';
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'A quantidade a transferir deve ser superior a zero.';
  END IF;

  -- 1. Verifica e bloqueia saldo na origem
  SELECT * INTO v_source_item
    FROM public.inventory_items
   WHERE company_id = p_company_id
     AND location_id = p_source_location_id
     AND lower(item_code) = lower(btrim(p_item_code))
   FOR UPDATE;

  IF NOT FOUND OR v_source_item.quantity < p_quantity THEN
    RAISE EXCEPTION 'Saldo insuficiente no local de origem (Saldo disponível: %; Solicitado: %).',
      coalesce(v_source_item.quantity, 0), p_quantity;
  END IF;

  -- 2. Deduz da origem
  UPDATE public.inventory_items
     SET quantity = quantity - p_quantity,
         updated_at = now()
   WHERE id = v_source_item.id;

  -- 3. Adiciona no destino
  SELECT * INTO v_dest_item
    FROM public.inventory_items
   WHERE company_id = p_company_id
     AND location_id = p_dest_location_id
     AND lower(item_code) = lower(btrim(p_item_code))
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.inventory_items
       SET quantity = quantity + p_quantity,
           updated_at = now()
     WHERE id = v_dest_item.id;
  ELSE
    INSERT INTO public.inventory_items (
      company_id, location_id, catalog_item_id, item_code, name, category,
      unit_of_measure, quantity, min_quantity, unit_cost, unit_price
    ) VALUES (
      p_company_id, p_dest_location_id, v_source_item.catalog_item_id, v_source_item.item_code,
      v_source_item.name, v_source_item.category, v_source_item.unit_of_measure,
      p_quantity, v_source_item.min_quantity, v_source_item.unit_cost, v_source_item.unit_price
    );
  END IF;

  -- 4. Registra os movimentos auditados
  INSERT INTO public.stock_movements (
    company_id, movement_type, source_location_id, destination_location_id,
    catalog_item_id, item_code, quantity, unit_cost, performed_by, notes
  ) VALUES
    (p_company_id, 'transfer_out', p_source_location_id, p_dest_location_id,
     v_source_item.catalog_item_id, v_source_item.item_code, p_quantity, v_source_item.unit_cost, auth.uid(), p_notes),
    (p_company_id, 'transfer_in', p_source_location_id, p_dest_location_id,
     v_source_item.catalog_item_id, v_source_item.item_code, p_quantity, v_source_item.unit_cost, auth.uid(), p_notes);

  RETURN true;
END;
$$;

-- 5.3 Consulta de Alertas de Estoque Baixo
CREATE OR REPLACE FUNCTION public.get_low_stock_alerts(p_company_id uuid)
RETURNS TABLE (
  item_id uuid,
  item_code text,
  item_name text,
  location_id uuid,
  location_name text,
  location_type text,
  current_quantity numeric,
  min_quantity numeric,
  unit_cost numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ii.id AS item_id,
    ii.item_code,
    ii.name AS item_name,
    sl.id AS location_id,
    sl.name AS location_name,
    sl.location_type,
    ii.quantity AS current_quantity,
    ii.min_quantity,
    ii.unit_cost
    FROM public.inventory_items ii
    JOIN public.stock_locations sl ON sl.id = ii.location_id
   WHERE ii.company_id = p_company_id
     AND sl.is_active = true
     AND ii.quantity <= ii.min_quantity
   ORDER BY (ii.quantity / nullif(ii.min_quantity, 0)) ASC;
$$;

-- ----------------------------------------------------------------------------
-- 6. TRIGGER DE BAIXA AUTOMÁTICA DE ESTOQUE NA APLICAÇÃO DE PEÇAS NA OS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_deplete_stock_on_so_item_applied()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_so record;
  v_tech_location_id uuid;
  v_central_location_id uuid;
  v_target_location_id uuid;
  v_inv_item record;
BEGIN
  -- Aciona apenas quando o status transiciona para 'applied' (peça efetivamente instalada)
  IF NEW.item_status = 'applied' AND (TG_OP = 'INSERT' OR OLD.item_status <> 'applied') THEN

    -- Verifica se já houve movimentação de baixa para este item de OS (idempotência estrita)
    IF EXISTS (
      SELECT 1 FROM public.stock_movements WHERE service_order_item_id = NEW.id
    ) THEN
      RETURN NEW;
    END IF;

    -- Obtém dados da Ordem de Serviço e técnico
    SELECT id, company_id, primary_technician_id
      INTO v_so
      FROM public.service_orders
     WHERE id = NEW.service_order_id;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    -- 1. Prioriza o estoque móvel do técnico responsável
    IF v_so.primary_technician_id IS NOT NULL THEN
      SELECT id INTO v_tech_location_id
        FROM public.stock_locations
       WHERE company_id = v_so.company_id
         AND technician_id = v_so.primary_technician_id
         AND is_active = true
       LIMIT 1;
    END IF;

    -- 2. Localiza o almoxarifado central como fallback
    SELECT id INTO v_central_location_id
      FROM public.stock_locations
     WHERE company_id = v_so.company_id
       AND location_type = 'central'
       AND is_active = true
     LIMIT 1;

    -- Define o local alvo
    IF v_tech_location_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.inventory_items
       WHERE location_id = v_tech_location_id
         AND lower(item_code) = lower(btrim(NEW.item_code))
         AND quantity >= NEW.quantity
    ) THEN
      v_target_location_id := v_tech_location_id;
    ELSE
      v_target_location_id := coalesce(v_tech_location_id, v_central_location_id);
    END IF;

    IF v_target_location_id IS NOT NULL THEN
      -- Atualiza o saldo se o registro existir
      SELECT * INTO v_inv_item
        FROM public.inventory_items
       WHERE location_id = v_target_location_id
         AND lower(item_code) = lower(btrim(NEW.item_code))
       FOR UPDATE;

      IF FOUND THEN
        UPDATE public.inventory_items
           SET quantity = GREATEST(0.00, quantity - NEW.quantity),
               updated_at = now()
         WHERE id = v_inv_item.id;
      END IF;

      -- Registra o movimento de consumo na OS com vinculo inequívoco
      INSERT INTO public.stock_movements (
        company_id, movement_type, source_location_id, catalog_item_id,
        item_code, quantity, unit_cost, service_order_id, service_order_item_id,
        technician_id, performed_by, notes
      ) VALUES (
        v_so.company_id, 'consumption', v_target_location_id, NEW.catalog_item_id,
        btrim(NEW.item_code), NEW.quantity, coalesce(v_inv_item.unit_cost, 0.00),
        v_so.id, NEW.id, v_so.primary_technician_id, auth.uid(),
        'Baixa automática por aplicação da peça na OS #' || coalesce(NEW.service_order_id::text, '')
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_deplete_stock_on_so_item_applied ON public.service_order_items;
CREATE TRIGGER trg_auto_deplete_stock_on_so_item_applied
  AFTER INSERT OR UPDATE OF item_status ON public.service_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_deplete_stock_on_so_item_applied();

-- ----------------------------------------------------------------------------
-- 7. TRIGGERS AUTOMÁTICOS DE INICIALIZAÇÃO DE LOCAIS
-- ----------------------------------------------------------------------------

-- 7.1 Garante Almoxarifado Central ao criar uma empresa
CREATE OR REPLACE FUNCTION public.ensure_company_default_stock_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.stock_locations (company_id, name, location_type, notes)
  VALUES (NEW.id, 'Almoxarifado Central', 'central', 'Estoque principal da matriz')
  ON CONFLICT (company_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_company_default_stock ON public.companies;
CREATE TRIGGER trg_ensure_company_default_stock
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_company_default_stock_location();

-- 7.2 Cria estoque móvel automaticamente quando um técnico for cadastrado
CREATE OR REPLACE FUNCTION public.ensure_technician_vehicle_stock_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.stock_locations (
    company_id, name, location_type, technician_id, notes
  ) VALUES (
    NEW.company_id,
    'Veículo - ' || btrim(NEW.full_name),
    'technician',
    NEW.id,
    'Estoque móvel para peças de pronto atendimento'
  )
  ON CONFLICT (company_id, technician_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_technician_stock ON public.technicians;
CREATE TRIGGER trg_ensure_technician_stock
  AFTER INSERT ON public.technicians
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_technician_vehicle_stock_location();

-- 7.3 Backfill inicial para empresas e técnicos já cadastrados
INSERT INTO public.stock_locations (company_id, name, location_type, notes)
SELECT id, 'Almoxarifado Central', 'central', 'Estoque principal da matriz'
FROM public.companies
ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO public.stock_locations (company_id, name, location_type, technician_id, notes)
SELECT company_id, 'Veículo - ' || btrim(full_name), 'technician', id, 'Estoque móvel para peças de pronto atendimento'
FROM public.technicians
ON CONFLICT (company_id, technician_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 8. POLÍTICAS DE ROW LEVEL SECURITY (RLS) MULTI-TENANT E PERFIL DE ESTOQUE
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- 8.1 stock_locations
CREATE POLICY stock_locations_select_policy ON public.stock_locations
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY stock_locations_manage_policy ON public.stock_locations
  FOR ALL TO authenticated
  USING (public.is_company_stock_manager(company_id))
  WITH CHECK (public.is_company_stock_manager(company_id));

-- 8.2 inventory_items
CREATE POLICY inventory_items_select_policy ON public.inventory_items
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY inventory_items_manage_policy ON public.inventory_items
  FOR ALL TO authenticated
  USING (public.is_company_stock_manager(company_id))
  WITH CHECK (public.is_company_stock_manager(company_id));

-- 8.3 stock_movements
CREATE POLICY stock_movements_select_policy ON public.stock_movements
  FOR SELECT TO authenticated
  USING (
    public.is_company_stock_manager(company_id)
    OR technician_id = public.current_technician_id(company_id)
    OR performed_by = auth.uid()
  );

CREATE POLICY stock_movements_insert_policy ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_stock_manager(company_id)
    OR technician_id = public.current_technician_id(company_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_movements TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_company_stock_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_stock_entry(uuid, uuid, uuid, text, text, text, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_stock_transfer(uuid, uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_low_stock_alerts(uuid) TO authenticated;

COMMIT;
