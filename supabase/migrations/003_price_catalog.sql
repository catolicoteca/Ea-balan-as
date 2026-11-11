-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Migração 003: Módulo de Catálogo de Preços de Peças/Serviços e Orçamento por OS
-- (Revisão Final de Segurança: Imutabilidade, Integridade de OS/Equipamento e RLS)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABELA: price_catalog_items (Catálogo Oficial da Empresa)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  category text NOT NULL,
  subcategory text,
  description text NOT NULL,
  condition text NOT NULL DEFAULT 'Nova',
  price_term numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (price_term >= 0),
  price_cash numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (price_cash >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_price_catalog_company_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_price_catalog_company ON public.price_catalog_items(company_id);
CREATE INDEX IF NOT EXISTS idx_price_catalog_category ON public.price_catalog_items(company_id, category);
CREATE INDEX IF NOT EXISTS idx_price_catalog_code ON public.price_catalog_items(company_id, code);

-- ----------------------------------------------------------------------------
-- 2. TABELA: service_order_items (Itens de Peças e Serviços vinculados à OS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  catalog_item_id uuid REFERENCES public.price_catalog_items(id) ON DELETE SET NULL,
  equipment_id uuid REFERENCES public.equipments(id) ON DELETE SET NULL,
  item_code text NOT NULL,
  description text NOT NULL,
  category text,
  condition text NOT NULL DEFAULT 'Nova',
  payment_modality text NOT NULL DEFAULT 'cash' CHECK (payment_modality IN ('cash', 'term')),
  quantity numeric(10, 2) NOT NULL DEFAULT 1.00 CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
  total_price numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_price >= 0),
  item_status text NOT NULL DEFAULT 'proposed' CHECK (item_status IN ('proposed', 'authorized', 'applied', 'rejected')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  authorized_at timestamptz,
  applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_so_items_company ON public.service_order_items(company_id);
CREATE INDEX IF NOT EXISTS idx_so_items_order ON public.service_order_items(service_order_id);
CREATE INDEX IF NOT EXISTS idx_so_items_equipment ON public.service_order_items(equipment_id);
CREATE INDEX IF NOT EXISTS idx_so_items_status ON public.service_order_items(company_id, item_status);

-- ----------------------------------------------------------------------------
-- 3. TABELA: price_catalog_imports (Histórico de Importações da Planilha)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_catalog_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_imports_company ON public.price_catalog_imports(company_id);

-- ----------------------------------------------------------------------------
-- 4. TRIGGERS DE ATUALIZAÇÃO TEMPORAL
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_price_catalog_items_updated_at ON public.price_catalog_items;
CREATE TRIGGER trg_price_catalog_items_updated_at
  BEFORE UPDATE ON public.price_catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_service_order_items_updated_at ON public.service_order_items;
CREATE TRIGGER trg_service_order_items_updated_at
  BEFORE UPDATE ON public.service_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. TRIGGER DE SEGURANÇA E AUDITORIA COMPLETA (Ciclo de Vida, Preço e Tenants)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_service_order_item_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_os_company_id uuid;
  v_os_client_id uuid;
  v_os_equipment_id uuid;
  v_catalog_company_id uuid;
  v_equip_company_id uuid;
  v_equip_client_id uuid;
  v_is_manager boolean;
  v_cat_record public.price_catalog_items%ROWTYPE;
  v_expected_price numeric(12, 2);
BEGIN
  -- 5.1 VALIDAÇÃO CRUZADA DA OS (Multi-tenant Integrity e Equipamento)
  SELECT company_id, client_id, equipment_id
    INTO v_os_company_id, v_os_client_id, v_os_equipment_id
    FROM public.service_orders
   WHERE id = NEW.service_order_id;

  IF v_os_company_id IS NULL THEN
    RAISE EXCEPTION 'Ordem de serviço inválida ou não encontrada.';
  END IF;

  -- Garante que o item herda compulsoriamente a mesma empresa da OS (não confia no frontend)
  NEW.company_id := v_os_company_id;

  -- Valida company_id do catálogo
  IF NEW.catalog_item_id IS NOT NULL THEN
    SELECT company_id INTO v_catalog_company_id
      FROM public.price_catalog_items
     WHERE id = NEW.catalog_item_id;

    IF v_catalog_company_id IS DISTINCT FROM v_os_company_id THEN
      RAISE EXCEPTION 'Violação multiempresa: o item de catálogo informado pertence a outra empresa.';
    END IF;
  END IF;

  -- Valida se o equipamento informado corresponde efetivamente à OS
  IF NEW.equipment_id IS NOT NULL THEN
    -- 1º: Valida se o equipamento pertence à mesma empresa e ao mesmo cliente da OS
    SELECT company_id, client_id INTO v_equip_company_id, v_equip_client_id
      FROM public.equipments
     WHERE id = NEW.equipment_id;

    IF v_equip_company_id IS DISTINCT FROM v_os_company_id THEN
      RAISE EXCEPTION 'Violação multiempresa: o equipamento informado pertence a outra empresa.';
    END IF;

    IF v_equip_client_id IS DISTINCT FROM v_os_client_id THEN
      RAISE EXCEPTION 'O equipamento informado pertence a outro cliente e não pode ser vinculado a esta Ordem de Serviço.';
    END IF;

    -- 2º: Se a OS tem equipamento fixado, o item DEVE pertencer a esse mesmo equipamento
    IF v_os_equipment_id IS NOT NULL AND NEW.equipment_id != v_os_equipment_id THEN
      RAISE EXCEPTION 'O equipamento informado (%) não corresponde ao equipamento vinculado a esta Ordem de Serviço (%).',
        NEW.equipment_id, v_os_equipment_id;
    END IF;
  ELSIF v_os_equipment_id IS NOT NULL THEN
    -- Herda automaticamente o equipamento fixado da OS se não foi explicitamente enviado
    NEW.equipment_id := v_os_equipment_id;
  END IF;

  -- Verifica se o ator é Gestor da empresa da OS
  v_is_manager := public.is_company_manager(v_os_company_id);

  -- 5.1 TRANSIÇÃO AUTHORIZED -> APPLIED: PREENCHIMENTO EXCLUSIVO NO BANCO
  -- Ignora qualquer valor de applied_by e applied_at enviado pelo cliente e preenche compulsoriamente no banco
  IF TG_OP = 'UPDATE' AND OLD.item_status = 'authorized' AND NEW.item_status = 'applied' THEN
    NEW.applied_by := auth.uid();
    NEW.applied_at := now();
  END IF;

  -- 5.2 BLOQUEIO DE MUDANÇA DE VÍNCULOS E DADOS ESTRUTURAIS PÓS-AUTORIZAÇÃO (Inclusive para Gestores)
  IF TG_OP = 'UPDATE' AND OLD.item_status IN ('authorized', 'applied') THEN
    IF NEW.service_order_id IS DISTINCT FROM OLD.service_order_id THEN
      RAISE EXCEPTION 'Itens autorizados ou aplicados não podem ser transferidos para outra Ordem de Serviço.';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'A empresa de um item autorizado ou aplicado não pode ser alterada.';
    END IF;
    IF NEW.catalog_item_id IS DISTINCT FROM OLD.catalog_item_id THEN
      RAISE EXCEPTION 'O item de catálogo de uma peça autorizada ou aplicada não pode ser alterado.';
    END IF;
    IF NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN
      RAISE EXCEPTION 'O equipamento vinculado a uma peça autorizada ou aplicada não pode ser alterado.';
    END IF;
  END IF;

  -- 5.3 BLOQUEIOS DE MODIFICAÇÃO DIRETA DE CAMPOS DE CONTROLE POR TÉCNICOS
  IF TG_OP = 'UPDATE' AND NOT v_is_manager THEN
    IF NEW.service_order_id IS DISTINCT FROM OLD.service_order_id THEN
      RAISE EXCEPTION 'Técnicos não têm permissão para alterar a Ordem de Serviço de um item.';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Técnicos não têm permissão para alterar a empresa do item.';
    END IF;
    IF NEW.catalog_item_id IS DISTINCT FROM OLD.catalog_item_id THEN
      RAISE EXCEPTION 'Técnicos não têm permissão para alterar o item de catálogo de uma peça já inserida.';
    END IF;
    IF NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN
      RAISE EXCEPTION 'Técnicos não têm permissão para alterar o equipamento vinculado à peça.';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'O autor original (created_by) do item não pode ser alterado.';
    END IF;
    IF (NEW.authorized_by IS DISTINCT FROM OLD.authorized_by) OR (NEW.authorized_at IS DISTINCT FROM OLD.authorized_at) THEN
      RAISE EXCEPTION 'Técnicos não têm permissão para manipular dados de autorização.';
    END IF;
    IF NOT (OLD.item_status = 'authorized' AND NEW.item_status = 'applied') THEN
      IF (NEW.applied_by IS DISTINCT FROM OLD.applied_by) OR (NEW.applied_at IS DISTINCT FROM OLD.applied_at) THEN
        RAISE EXCEPTION 'Técnicos não têm permissão para manipular diretamente os campos de aplicação.';
      END IF;
    END IF;
  END IF;

  -- 5.4 PRESERVAÇÃO INTEGRAL DE DADOS COMERCIAIS APÓS AUTORIZAÇÃO E BLOQUEIO DE MODIFICAÇÕES (Para Técnicos)
  IF TG_OP = 'UPDATE' AND NOT v_is_manager THEN
    IF OLD.item_status = 'authorized' THEN
      -- A única operação permitida ao técnico é a transição para 'applied'
      IF NEW.item_status = 'applied' THEN
        NEW.applied_by := auth.uid();
        NEW.applied_at := now();
      ELSIF NEW.item_status = 'authorized' THEN
        RAISE EXCEPTION 'Técnicos não têm permissão para atualizar itens autorizados sem realizar a transição de status para aplicado.';
      ELSE
        RAISE EXCEPTION 'Técnicos só podem transicionar itens autorizados para o estado aplicado.';
      END IF;

      -- Preserva compulsoriamente todos os dados comerciais e vínculos originais
      NEW.unit_price := OLD.unit_price;
      NEW.quantity := OLD.quantity;
      NEW.discount_amount := OLD.discount_amount;
      NEW.total_price := OLD.total_price;
      NEW.payment_modality := OLD.payment_modality;
      NEW.item_code := OLD.item_code;
      NEW.description := OLD.description;
      NEW.category := OLD.category;
      NEW.condition := OLD.condition;
      NEW.catalog_item_id := OLD.catalog_item_id;
      NEW.equipment_id := OLD.equipment_id;
      NEW.service_order_id := OLD.service_order_id;
      NEW.company_id := OLD.company_id;
      NEW.created_by := OLD.created_by;
      NEW.authorized_by := OLD.authorized_by;
      NEW.authorized_at := OLD.authorized_at;
      RETURN NEW;
    ELSIF OLD.item_status = 'applied' THEN
      -- Peça aplicada é terminal para o técnico; nenhuma alteração é permitida
      RAISE EXCEPTION 'Itens já aplicados não podem ser alterados por técnicos.';
    ELSIF OLD.item_status = 'rejected' THEN
      RAISE EXCEPTION 'Itens rejeitados não podem ser alterados por técnicos.';
    END IF;
  END IF;

  -- 5.5 VALIDAÇÃO DE PREÇOS OFICIAIS E DESCONTOS (Para Propostas e Gestão)
  -- Busca o item de catálogo por ID ou por código oficial da empresa
  IF NEW.catalog_item_id IS NOT NULL THEN
    SELECT * INTO v_cat_record
      FROM public.price_catalog_items
     WHERE id = NEW.catalog_item_id AND company_id = v_os_company_id;
  ELSE
    SELECT * INTO v_cat_record
      FROM public.price_catalog_items
     WHERE code = NEW.item_code AND company_id = v_os_company_id
     LIMIT 1;
    IF v_cat_record.id IS NOT NULL THEN
      NEW.catalog_item_id := v_cat_record.id;
    END IF;
  END IF;

  -- Se encontrou no catálogo oficial, obtém o preço oficial conforme a modalidade
  IF v_cat_record.id IS NOT NULL THEN
    IF NEW.payment_modality = 'cash' THEN
      v_expected_price := v_cat_record.price_cash;
    ELSE
      v_expected_price := v_cat_record.price_term;
    END IF;

    -- Se for técnico (não-gestor) em proposta (INSERT ou UPDATE de 'proposed'):
    -- Impõe obrigatoriamente o preço oficial e zera descontos
    IF NOT v_is_manager AND (TG_OP = 'INSERT' OR OLD.item_status = 'proposed') THEN
      NEW.unit_price := v_expected_price;
      NEW.discount_amount := 0.00;
    ELSIF NEW.unit_price IS NULL OR NEW.unit_price <= 0 THEN
      NEW.unit_price := v_expected_price;
    END IF;
  ELSE
    -- Item avulso sem catálogo: permitido exclusivamente para Gestores
    IF NOT v_is_manager THEN
      RAISE EXCEPTION 'Técnicos só podem adicionar peças e serviços cadastrados no catálogo oficial.';
    END IF;
  END IF;

  -- Cálculo garantido do total_price no backend
  NEW.discount_amount := COALESCE(NEW.discount_amount, 0.00);
  NEW.total_price := round((NEW.quantity * NEW.unit_price) - NEW.discount_amount, 2);
  IF NEW.total_price < 0 THEN
    NEW.total_price := 0.00;
  END IF;

  -- 5.6 VALIDAÇÃO DE INSERÇÃO (INSERT)
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    -- Técnicos sempre inserem como 'proposed'
    IF NOT v_is_manager THEN
      NEW.item_status := 'proposed';
      NEW.authorized_by := null;
      NEW.authorized_at := null;
      NEW.applied_by := null;
      NEW.applied_at := null;
    ELSIF NEW.item_status = 'authorized' THEN
      NEW.authorized_by := auth.uid();
      NEW.authorized_at := now();
    ELSIF NEW.item_status = 'applied' THEN
      NEW.authorized_by := auth.uid();
      NEW.authorized_at := now();
      NEW.applied_by := auth.uid();
      NEW.applied_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- 5.7 VALIDAÇÃO DE ATUALIZAÇÃO (UPDATE - Fluxo de Gestor e Propostas de Técnicos)
  IF TG_OP = 'UPDATE' THEN
    IF NOT v_is_manager THEN
      -- Se a proposta era de outro usuário e está 'proposed', bloqueia edição por terceiros
      IF OLD.created_by IS DISTINCT FROM auth.uid() AND OLD.item_status = 'proposed' THEN
        RAISE EXCEPTION 'Técnicos só podem alterar propostas de peças cadastradas por eles mesmos.';
      END IF;

      -- Técnico tentando marcar como 'authorized' -> bloqueia
      IF (NEW.item_status = 'authorized' AND OLD.item_status IS DISTINCT FROM 'authorized') THEN
        RAISE EXCEPTION 'Apenas gestores têm permissão para aprovar itens e orçamentos na OS.';
      END IF;

      -- Técnico tentando marcar como 'applied' sem autorização prévia -> bloqueia
      IF (NEW.item_status = 'applied' AND OLD.item_status IS DISTINCT FROM 'applied') THEN
        IF OLD.item_status != 'authorized' THEN
          RAISE EXCEPTION 'A peça não pode ser registrada como aplicada sem prévia autorização.';
        END IF;
        NEW.applied_by := auth.uid();
        NEW.applied_at := now();
      END IF;
    ELSE
      -- Gestor atualizando:
      IF (NEW.item_status = 'authorized' AND OLD.item_status IS DISTINCT FROM 'authorized') THEN
        NEW.authorized_by := auth.uid();
        NEW.authorized_at := now();
      ELSIF (NEW.item_status = 'applied' AND OLD.item_status IS DISTINCT FROM 'applied') THEN
        NEW.applied_by := COALESCE(NEW.applied_by, auth.uid());
        NEW.applied_at := COALESCE(NEW.applied_at, now());
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_service_order_item_lifecycle ON public.service_order_items;
CREATE TRIGGER trg_validate_service_order_item_lifecycle
  BEFORE INSERT OR UPDATE ON public.service_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_service_order_item_lifecycle();

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) MULTI-TENANT E POR ATRIBUIÇÃO
-- ----------------------------------------------------------------------------
ALTER TABLE public.price_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_catalog_imports ENABLE ROW LEVEL SECURITY;

-- 6.1 Políticas: price_catalog_items
DROP POLICY IF EXISTS catalog_items_select_policy ON public.price_catalog_items;
CREATE POLICY catalog_items_select_policy ON public.price_catalog_items
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS catalog_items_insert_policy ON public.price_catalog_items;
CREATE POLICY catalog_items_insert_policy ON public.price_catalog_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS catalog_items_update_policy ON public.price_catalog_items;
CREATE POLICY catalog_items_update_policy ON public.price_catalog_items
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS catalog_items_delete_policy ON public.price_catalog_items;
CREATE POLICY catalog_items_delete_policy ON public.price_catalog_items
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 6.2 Políticas: service_order_items
-- Leitura: Qualquer usuário autorizado a visualizar a OS (gestor ou técnico atribuído)
DROP POLICY IF EXISTS so_items_select_policy ON public.service_order_items;
CREATE POLICY so_items_select_policy ON public.service_order_items
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id));

-- Inserção: Usuário autorizado na OS
DROP POLICY IF EXISTS so_items_insert_policy ON public.service_order_items;
CREATE POLICY so_items_insert_policy ON public.service_order_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_service_order(service_order_id, company_id));

-- Atualização: Gestor tem permissão irrestrita.
-- Técnico pode atualizar propostas próprias ('proposed') ou transicionar 'authorized' -> 'applied'.
-- O trigger valida e bloqueia qualquer edição sem mudança de status em 'authorized' ou 'applied'.
DROP POLICY IF EXISTS so_items_update_policy ON public.service_order_items;
CREATE POLICY so_items_update_policy ON public.service_order_items
  FOR UPDATE TO authenticated
  USING (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_manager(company_id)
      OR (created_by = auth.uid() AND item_status = 'proposed')
      OR item_status IN ('authorized', 'applied')
    )
  )
  WITH CHECK (
    public.can_access_service_order(service_order_id, company_id)
  );

-- Exclusão: Gestor pode excluir.
-- Técnico SÓ PODE excluir itens que ele mesmo propôs e que estejam em status 'proposed'.
-- Itens 'authorized', 'applied' ou 'rejected' não podem ser excluídos por técnicos.
DROP POLICY IF EXISTS so_items_delete_policy ON public.service_order_items;
CREATE POLICY so_items_delete_policy ON public.service_order_items
  FOR DELETE TO authenticated
  USING (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_manager(company_id)
      OR (
        created_by = auth.uid()
        AND item_status = 'proposed'
      )
    )
  );

-- 6.3 Políticas: price_catalog_imports
DROP POLICY IF EXISTS catalog_imports_select_policy ON public.price_catalog_imports;
CREATE POLICY catalog_imports_select_policy ON public.price_catalog_imports
  FOR SELECT TO authenticated
  USING (public.is_company_manager(company_id));

DROP POLICY IF EXISTS catalog_imports_insert_policy ON public.price_catalog_imports;
CREATE POLICY catalog_imports_insert_policy ON public.price_catalog_imports
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

-- ----------------------------------------------------------------------------
-- 7. PRIVILÉGIOS (GRANTS) PARA USUÁRIOS AUTENTICADOS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.price_catalog_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.price_catalog_imports TO authenticated;

COMMIT;
