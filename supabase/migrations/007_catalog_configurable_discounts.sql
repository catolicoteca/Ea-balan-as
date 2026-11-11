-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Migração 007: Descontos Configuráveis por Modalidade e Exceção por Item
-- Preserva os 130 itens oficiais e garante validação estrita no PostgreSQL.
-- Requer que a Migração 003 já esteja aplicada (e recomenda-se aplicar após 006).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. DESCONTOS PADRÃO POR MODALIDADE NA EMPRESA (Configurados pelo Gestor)
-- ----------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS discount_cash_percent numeric(5, 2) NOT NULL DEFAULT 0.00
    CHECK (discount_cash_percent >= 0 AND discount_cash_percent <= 100),
  ADD COLUMN IF NOT EXISTS discount_term_percent numeric(5, 2) NOT NULL DEFAULT 0.00
    CHECK (discount_term_percent >= 0 AND discount_term_percent <= 100);

-- ----------------------------------------------------------------------------
-- 2. EXCEÇÃO DE DESCONTO OPCIONAL POR ITEM DO CATÁLOGO
-- Quando NULL, o item herda o percentual padrão da empresa para a modalidade.
-- ----------------------------------------------------------------------------
ALTER TABLE public.price_catalog_items
  ADD COLUMN IF NOT EXISTS discount_cash_percent numeric(5, 2)
    CHECK (discount_cash_percent IS NULL OR (discount_cash_percent >= 0 AND discount_cash_percent <= 100)),
  ADD COLUMN IF NOT EXISTS discount_term_percent numeric(5, 2)
    CHECK (discount_term_percent IS NULL OR (discount_term_percent >= 0 AND discount_term_percent <= 100));

-- ----------------------------------------------------------------------------
-- 3. HISTÓRICO IMUTÁVEL NA OS: PREÇO-BASE, % DESCONTO E VALOR FINAL
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_order_items
  ADD COLUMN IF NOT EXISTS base_unit_price numeric(12, 2) NOT NULL DEFAULT 0.00
    CHECK (base_unit_price >= 0),
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5, 2) NOT NULL DEFAULT 0.00
    CHECK (discount_percent >= 0 AND discount_percent <= 100);

-- Backfill não destrutivo para itens já gravados anteriormente
-- Desabilita temporariamente a trigger nesta transação para não acionar bloqueios
-- de status ('authorized'/'applied'/'rejected') nem recalcular valores históricos.
ALTER TABLE public.service_order_items DISABLE TRIGGER trg_validate_service_order_item_lifecycle;

UPDATE public.service_order_items
   SET base_unit_price = unit_price
 WHERE base_unit_price = 0
   AND unit_price > 0;

ALTER TABLE public.service_order_items ENABLE TRIGGER trg_validate_service_order_item_lifecycle;

-- ----------------------------------------------------------------------------
-- 4. AUDITORIA ESTENDIDA PARA DESCONTOS POR ITEM (Compatível com 006)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_price_catalog_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_type text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  -- Só grava se a tabela de histórico (migração 006) existir
  IF to_regclass('public.price_catalog_history') IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.price_catalog_history (
      company_id, catalog_item_id, item_code, event_type,
      old_price_cash, new_price_cash, old_price_term, new_price_term,
      old_is_active, new_is_active, changes, changed_by
    ) VALUES (
      NEW.company_id, NEW.id, NEW.code, 'created',
      NULL, NEW.price_cash, NULL, NEW.price_term,
      NULL, NEW.is_active,
      jsonb_build_object(
        'description', NEW.description,
        'category', NEW.category,
        'condition', NEW.condition,
        'discount_cash_percent', NEW.discount_cash_percent,
        'discount_term_percent', NEW.discount_term_percent
      ),
      COALESCE(auth.uid(), NEW.created_by)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.code IS NOT DISTINCT FROM OLD.code
       AND NEW.category IS NOT DISTINCT FROM OLD.category
       AND NEW.subcategory IS NOT DISTINCT FROM OLD.subcategory
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.condition IS NOT DISTINCT FROM OLD.condition
       AND NEW.price_cash IS NOT DISTINCT FROM OLD.price_cash
       AND NEW.price_term IS NOT DISTINCT FROM OLD.price_term
       AND NEW.discount_cash_percent IS NOT DISTINCT FROM OLD.discount_cash_percent
       AND NEW.discount_term_percent IS NOT DISTINCT FROM OLD.discount_term_percent
       AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
      RETURN NEW;
    END IF;

    IF NEW.price_cash IS DISTINCT FROM OLD.price_cash
       OR NEW.price_term IS DISTINCT FROM OLD.price_term
       OR NEW.discount_cash_percent IS DISTINCT FROM OLD.discount_cash_percent
       OR NEW.discount_term_percent IS DISTINCT FROM OLD.discount_term_percent THEN
      v_event_type := 'price_updated';
    ELSIF OLD.is_active = true AND NEW.is_active = false THEN
      v_event_type := 'deactivated';
    ELSIF OLD.is_active = false AND NEW.is_active = true THEN
      v_event_type := 'activated';
    ELSE
      v_event_type := 'updated';
    END IF;

    IF NEW.description IS DISTINCT FROM OLD.description THEN
      v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', OLD.description, 'new', NEW.description));
    END IF;
    IF NEW.category IS DISTINCT FROM OLD.category THEN
      v_changes := v_changes || jsonb_build_object('category', jsonb_build_object('old', OLD.category, 'new', NEW.category));
    END IF;
    IF NEW.condition IS DISTINCT FROM OLD.condition THEN
      v_changes := v_changes || jsonb_build_object('condition', jsonb_build_object('old', OLD.condition, 'new', NEW.condition));
    END IF;
    IF NEW.code IS DISTINCT FROM OLD.code THEN
      v_changes := v_changes || jsonb_build_object('code', jsonb_build_object('old', OLD.code, 'new', NEW.code));
    END IF;
    IF NEW.discount_cash_percent IS DISTINCT FROM OLD.discount_cash_percent THEN
      v_changes := v_changes || jsonb_build_object('discount_cash_percent', jsonb_build_object('old', OLD.discount_cash_percent, 'new', NEW.discount_cash_percent));
    END IF;
    IF NEW.discount_term_percent IS DISTINCT FROM OLD.discount_term_percent THEN
      v_changes := v_changes || jsonb_build_object('discount_term_percent', jsonb_build_object('old', OLD.discount_term_percent, 'new', NEW.discount_term_percent));
    END IF;

    INSERT INTO public.price_catalog_history (
      company_id, catalog_item_id, item_code, event_type,
      old_price_cash, new_price_cash, old_price_term, new_price_term,
      old_is_active, new_is_active, changes, changed_by
    ) VALUES (
      NEW.company_id, NEW.id, NEW.code, v_event_type,
      OLD.price_cash, NEW.price_cash, OLD.price_term, NEW.price_term,
      OLD.is_active, NEW.is_active, v_changes, auth.uid()
    );
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. TRIGGER ATUALIZADO DE CICLO DE VIDA, PREÇO-BASE E DESCONTO AUTORIZADO
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_service_order_item_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_company_discount_cash numeric(5, 2) := 0.00;
  v_company_discount_term numeric(5, 2) := 0.00;
  v_base_price numeric(12, 2);
  v_authorized_discount_pct numeric(5, 2) := 0.00;
  v_effective_unit_price numeric(12, 2);
BEGIN
  -- 5.1 VALIDAÇÃO CRUZADA DA OS (Multi-tenant Integrity e Equipamento)
  SELECT company_id, client_id, equipment_id
    INTO v_os_company_id, v_os_client_id, v_os_equipment_id
    FROM public.service_orders
   WHERE id = NEW.service_order_id;

  IF v_os_company_id IS NULL THEN
    RAISE EXCEPTION 'Ordem de serviço inválida ou não encontrada.';
  END IF;

  NEW.company_id := v_os_company_id;

  IF NEW.catalog_item_id IS NOT NULL THEN
    SELECT company_id INTO v_catalog_company_id
      FROM public.price_catalog_items
     WHERE id = NEW.catalog_item_id;

    IF v_catalog_company_id IS DISTINCT FROM v_os_company_id THEN
      RAISE EXCEPTION 'Violação multiempresa: o item de catálogo informado pertence a outra empresa.';
    END IF;
  END IF;

  IF NEW.equipment_id IS NOT NULL THEN
    SELECT company_id, client_id INTO v_equip_company_id, v_equip_client_id
      FROM public.equipments
     WHERE id = NEW.equipment_id;

    IF v_equip_company_id IS DISTINCT FROM v_os_company_id THEN
      RAISE EXCEPTION 'Violação multiempresa: o equipamento informado pertence a outra empresa.';
    END IF;

    IF v_equip_client_id IS DISTINCT FROM v_os_client_id THEN
      RAISE EXCEPTION 'O equipamento informado pertence a outro cliente e não pode ser vinculado a esta Ordem de Serviço.';
    END IF;

    IF v_os_equipment_id IS NOT NULL AND NEW.equipment_id != v_os_equipment_id THEN
      RAISE EXCEPTION 'O equipamento informado (%) não corresponde ao equipamento vinculado a esta Ordem de Serviço (%).',
        NEW.equipment_id, v_os_equipment_id;
    END IF;
  ELSIF v_os_equipment_id IS NOT NULL THEN
    NEW.equipment_id := v_os_equipment_id;
  END IF;

  v_is_manager := public.is_company_manager(v_os_company_id);

  -- 5.2 TRANSIÇÃO AUTHORIZED -> APPLIED: PREENCHIMENTO EXCLUSIVO NO BANCO
  IF TG_OP = 'UPDATE' AND OLD.item_status = 'authorized' AND NEW.item_status = 'applied' THEN
    NEW.applied_by := auth.uid();
    NEW.applied_at := now();
  END IF;

  -- 5.3 BLOQUEIO DE MUDANÇA DE VÍNCULOS E DADOS ESTRUTURAIS PÓS-AUTORIZAÇÃO
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

    -- Preserva valores históricos congelados na autorização (inclusive para reajustes posteriores no catálogo)
    NEW.quantity := OLD.quantity;
    NEW.payment_modality := OLD.payment_modality;
    NEW.base_unit_price := OLD.base_unit_price;
    NEW.discount_percent := OLD.discount_percent;
    NEW.unit_price := OLD.unit_price;
    NEW.discount_amount := OLD.discount_amount;
    NEW.total_price := OLD.total_price;
  END IF;

  -- 5.4 BLOQUEIOS PARA TÉCNICOS
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

    IF OLD.item_status = 'authorized' THEN
      IF NEW.item_status = 'applied' THEN
        NEW.applied_by := auth.uid();
        NEW.applied_at := now();
      ELSIF NEW.item_status = 'authorized' THEN
        RAISE EXCEPTION 'Técnicos não têm permissão para atualizar itens autorizados sem realizar a transição de status para aplicado.';
      ELSE
        RAISE EXCEPTION 'Técnicos só podem transicionar itens autorizados para o estado aplicado.';
      END IF;

      NEW.base_unit_price := OLD.base_unit_price;
      NEW.discount_percent := OLD.discount_percent;
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
      RAISE EXCEPTION 'Itens já aplicados não podem ser alterados por técnicos.';
    ELSIF OLD.item_status = 'rejected' THEN
      RAISE EXCEPTION 'Itens rejeitados não podem ser alterados por técnicos.';
    END IF;
  END IF;

  -- Se gestor já está apenas concluindo/aplicando item já autorizado, preserva valores
  IF TG_OP = 'UPDATE' AND v_is_manager AND OLD.item_status IN ('authorized', 'applied') THEN
    IF NEW.item_status = 'applied' AND OLD.item_status = 'authorized' THEN
      NEW.applied_by := COALESCE(NEW.applied_by, auth.uid());
      NEW.applied_at := COALESCE(NEW.applied_at, now());
    END IF;
    RETURN NEW;
  END IF;

  -- 5.5 CÁLCULO OFICIAL DE PREÇO-BASE, DESCONTO CONFIGURADO E PREÇO FINAL
  SELECT COALESCE(discount_cash_percent, 0.00), COALESCE(discount_term_percent, 0.00)
    INTO v_company_discount_cash, v_company_discount_term
    FROM public.companies
   WHERE id = v_os_company_id;

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

  IF v_cat_record.id IS NOT NULL THEN
    IF NEW.payment_modality = 'cash' THEN
      v_base_price := v_cat_record.price_cash;
      v_authorized_discount_pct := COALESCE(v_cat_record.discount_cash_percent, v_company_discount_cash, 0.00);
    ELSE
      v_base_price := v_cat_record.price_term;
      v_authorized_discount_pct := COALESCE(v_cat_record.discount_term_percent, v_company_discount_term, 0.00);
    END IF;

    v_effective_unit_price := round(v_base_price * (1.0 - (v_authorized_discount_pct / 100.0)), 2);

    IF NOT v_is_manager THEN
      -- Para técnicos em INSERT ou UPDATE de 'proposed':
      -- IMPÕE compulsoriamente preço-base, percentual autorizado e preço final calculado no servidor
      NEW.base_unit_price := v_base_price;
      NEW.discount_percent := v_authorized_discount_pct;
      NEW.unit_price := v_effective_unit_price;
      NEW.discount_amount := round((v_base_price - v_effective_unit_price) * NEW.quantity, 2);
      NEW.total_price := round(NEW.quantity * v_effective_unit_price, 2);
    ELSE
      -- Para Gestor: usa o catálogo/desconto autorizado por padrão, permitindo ajuste manual se informado
      NEW.base_unit_price := CASE
        WHEN COALESCE(NEW.base_unit_price, 0) > 0 THEN NEW.base_unit_price
        ELSE v_base_price
      END;

      IF NEW.discount_percent IS NULL THEN
        NEW.discount_percent := v_authorized_discount_pct;
      END IF;

      IF COALESCE(NEW.unit_price, 0) <= 0 THEN
        NEW.unit_price := round(NEW.base_unit_price * (1.0 - (NEW.discount_percent / 100.0)), 2);
      END IF;

      IF TG_OP = 'UPDATE'
         AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
         AND NEW.base_unit_price IS NOT DISTINCT FROM OLD.base_unit_price
         AND NEW.discount_percent IS NOT DISTINCT FROM OLD.discount_percent
         AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
         AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount THEN
        -- Apenas mudança de status/notas: preserva exatamente os totais gravados na proposta original
        NEW.total_price := COALESCE(NEW.total_price, GREATEST(0.00, round(NEW.quantity * NEW.unit_price, 2)));
      ELSE
        IF NEW.discount_amount IS NULL OR (TG_OP = 'UPDATE' AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount AND (NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent OR NEW.unit_price IS DISTINCT FROM OLD.unit_price)) THEN
          NEW.discount_amount := GREATEST(0.00, round((NEW.base_unit_price - NEW.unit_price) * NEW.quantity, 2));
        END IF;
        NEW.total_price := GREATEST(0.00, round(NEW.quantity * NEW.unit_price, 2));
      END IF;
    END IF;
  ELSE
    -- Item avulso sem catálogo: permitido exclusivamente para Gestores
    IF NOT v_is_manager THEN
      RAISE EXCEPTION 'Técnicos só podem adicionar peças e serviços cadastrados no catálogo oficial.';
    END IF;

    NEW.base_unit_price := COALESCE(NULLIF(NEW.base_unit_price, 0), NEW.unit_price, 0.00);
    NEW.discount_percent := COALESCE(NEW.discount_percent, 0.00);
    NEW.discount_amount := COALESCE(NEW.discount_amount, 0.00);
    NEW.total_price := GREATEST(0.00, round((NEW.quantity * NEW.unit_price) - NEW.discount_amount, 2));
  END IF;

  -- 5.6 VALIDAÇÃO DE INSERÇÃO / ATUALIZAÇÃO DE STATUS
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
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

  IF TG_OP = 'UPDATE' THEN
    IF NOT v_is_manager THEN
      IF OLD.created_by IS DISTINCT FROM auth.uid() AND OLD.item_status = 'proposed' THEN
        RAISE EXCEPTION 'Técnicos só podem alterar propostas de peças cadastradas por eles mesmos.';
      END IF;
      IF (NEW.item_status = 'authorized' AND OLD.item_status IS DISTINCT FROM 'authorized') THEN
        RAISE EXCEPTION 'Apenas gestores têm permissão para aprovar itens e orçamentos na OS.';
      END IF;
      IF (NEW.item_status = 'applied' AND OLD.item_status IS DISTINCT FROM 'applied') THEN
        IF OLD.item_status != 'authorized' THEN
          RAISE EXCEPTION 'A peça não pode ser registrada como aplicada sem prévia autorização.';
        END IF;
        NEW.applied_by := auth.uid();
        NEW.applied_at := now();
      END IF;
    ELSE
      IF (NEW.item_status = 'authorized' AND OLD.item_status IS DISTINCT FROM 'authorized') THEN
        NEW.authorized_by := auth.uid();
        NEW.authorized_at := now();
      ELSIF (NEW.item_status = 'applied' AND OLD.item_status IS DISTINCT FROM 'applied') THEN
        NEW.applied_by := COALESCE(NEW.applied_by, auth.uid());
        NEW.applied_at := COALESCE(NEW.applied_at, now());
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. REALTIME PARA ATUALIZAÇÃO AUTOMÁTICA DO CATÁLOGO NO TÉCNICO (Sem F5)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.price_catalog_items;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.companies;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

COMMIT;
