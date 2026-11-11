-- ============================================================================
-- EA Balanças / Metrion — Rollback Seguro da Migração 007
-- (Descontos Configuráveis por Modalidade e Exceção por Item)
--
-- GARANTIA DE PRESERVAÇÃO DE DADOS:
-- Este script NÃO remove colunas nem apaga dados históricos das OS, dos 130 itens
-- do catálogo ou das configurações de empresa sem confirmação explícita.
-- Ele restaura integralmente as funções e triggers anteriores (003 e 006) e
-- remove as tabelas da publicação Realtime.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. REMOVER TABELAS DA PUBLICAÇÃO SUPABASE REALTIME
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.price_catalog_items;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.companies;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. RESTAURAR TRIGGER DE VALIDAÇÃO DA OS PARA A VERSÃO ORIGINAL DA MIGRAÇÃO 003
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

  -- 5.1 TRANSIÇÃO AUTHORIZED -> APPLIED
  IF TG_OP = 'UPDATE' AND OLD.item_status = 'authorized' AND NEW.item_status = 'applied' THEN
    NEW.applied_by := auth.uid();
    NEW.applied_at := now();
  END IF;

  -- 5.2 BLOQUEIO DE MUDANÇA DE VÍNCULOS PÓS-AUTORIZAÇÃO
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

  -- 5.4 PRESERVAÇÃO INTEGRAL DE DADOS COMERCIAIS APÓS AUTORIZAÇÃO (Para Técnicos)
  IF TG_OP = 'UPDATE' AND NOT v_is_manager THEN
    IF OLD.item_status = 'authorized' THEN
      IF NEW.item_status = 'applied' THEN
        NEW.applied_by := auth.uid();
        NEW.applied_at := now();
      ELSIF NEW.item_status = 'authorized' THEN
        RAISE EXCEPTION 'Técnicos não têm permissão para atualizar itens autorizados sem realizar a transição de status para aplicado.';
      ELSE
        RAISE EXCEPTION 'Técnicos só podem transicionar itens autorizados para o estado aplicado.';
      END IF;

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

  -- 5.5 VALIDAÇÃO DE PREÇOS OFICIAIS DA 003 (Sem descontos configuráveis)
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
      v_expected_price := v_cat_record.price_cash;
    ELSE
      v_expected_price := v_cat_record.price_term;
    END IF;

    IF NOT v_is_manager AND (TG_OP = 'INSERT' OR OLD.item_status = 'proposed') THEN
      NEW.unit_price := v_expected_price;
      NEW.discount_amount := 0.00;
    ELSIF NEW.unit_price IS NULL OR NEW.unit_price <= 0 THEN
      NEW.unit_price := v_expected_price;
    END IF;
  ELSE
    IF NOT v_is_manager THEN
      RAISE EXCEPTION 'Técnicos só podem adicionar peças e serviços cadastrados no catálogo oficial.';
    END IF;
  END IF;

  NEW.discount_amount := COALESCE(NEW.discount_amount, 0.00);
  NEW.total_price := round((NEW.quantity * NEW.unit_price) - NEW.discount_amount, 2);
  IF NEW.total_price < 0 THEN
    NEW.total_price := 0.00;
  END IF;

  -- 5.6 VALIDAÇÃO DE INSERÇÃO
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

  -- 5.7 VALIDAÇÃO DE ATUALIZAÇÃO
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
-- 3. RESTAURAR AUDITORIA DO CATÁLOGO PARA A VERSÃO DA MIGRAÇÃO 006 (SE EXISTIR)
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
        'condition', NEW.condition
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
       AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
      RETURN NEW;
    END IF;

    IF NEW.price_cash IS DISTINCT FROM OLD.price_cash OR NEW.price_term IS DISTINCT FROM OLD.price_term THEN
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
-- 4. REMOÇÃO OPCIONAL DE COLUNAS (SOMENTE COM CONFIRMAÇÃO EXPLÍCITA DO ADMIN)
-- Mantido comentado intencionalmente para NÃO destruir dados históricos de
-- descontos ou valores-base gravados em OS após a migração 007.
-- ----------------------------------------------------------------------------
/*
ALTER TABLE public.service_order_items
  DROP COLUMN IF EXISTS discount_percent,
  DROP COLUMN IF EXISTS base_unit_price;

ALTER TABLE public.price_catalog_items
  DROP COLUMN IF EXISTS discount_term_percent,
  DROP COLUMN IF EXISTS discount_cash_percent;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS discount_term_percent,
  DROP COLUMN IF EXISTS discount_cash_percent;
*/

COMMIT;
