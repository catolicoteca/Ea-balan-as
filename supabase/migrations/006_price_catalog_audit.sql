-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Migração 006: Auditoria de Alterações no Catálogo de Preços
-- Preserva integralmente os 130 itens oficiais e cria trilha imutável de histórico.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABELA: price_catalog_history (Auditoria de Cadastro e Preços)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_catalog_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES public.price_catalog_items(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('created', 'price_updated', 'updated', 'activated', 'deactivated')
  ),
  old_price_cash numeric(12, 2),
  new_price_cash numeric(12, 2),
  old_price_term numeric(12, 2),
  new_price_term numeric(12, 2),
  old_is_active boolean,
  new_is_active boolean,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_catalog_history_company
  ON public.price_catalog_history(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_catalog_history_item
  ON public.price_catalog_history(catalog_item_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. TRIGGER: Registro Automático e Imutável de Alterações no Catálogo
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
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.price_catalog_history (
      company_id,
      catalog_item_id,
      item_code,
      event_type,
      old_price_cash,
      new_price_cash,
      old_price_term,
      new_price_term,
      old_is_active,
      new_is_active,
      changes,
      changed_by
    ) VALUES (
      NEW.company_id,
      NEW.id,
      NEW.code,
      'created',
      NULL,
      NEW.price_cash,
      NULL,
      NEW.price_term,
      NULL,
      NEW.is_active,
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
    -- Verifica se houve alguma alteração relevante
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
      company_id,
      catalog_item_id,
      item_code,
      event_type,
      old_price_cash,
      new_price_cash,
      old_price_term,
      new_price_term,
      old_is_active,
      new_is_active,
      changes,
      changed_by
    ) VALUES (
      NEW.company_id,
      NEW.id,
      NEW.code,
      v_event_type,
      OLD.price_cash,
      NEW.price_cash,
      OLD.price_term,
      NEW.price_term,
      OLD.is_active,
      NEW.is_active,
      v_changes,
      auth.uid()
    );
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_price_catalog_changes ON public.price_catalog_items;
CREATE TRIGGER trg_audit_price_catalog_changes
  AFTER INSERT OR UPDATE ON public.price_catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_price_catalog_changes();

-- ----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (Somente Gestores da Empresa visualizam auditoria)
-- ----------------------------------------------------------------------------
ALTER TABLE public.price_catalog_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_history_select_policy ON public.price_catalog_history;
CREATE POLICY catalog_history_select_policy ON public.price_catalog_history
  FOR SELECT TO authenticated
  USING (public.is_company_manager(company_id));

GRANT SELECT ON TABLE public.price_catalog_history TO authenticated;

COMMIT;
