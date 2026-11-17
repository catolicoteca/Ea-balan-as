-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Migração 009: Portaria Inmetro/Dimel e Múltiplas Balanças por Ordem de Serviço
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
-- Permite que o gestor ou técnico atenda 1 ou mais balanças na mesma visita.
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
-- 3. POLÍTICAS DE ROW LEVEL SECURITY (RLS) MULTI-TENANT
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_order_equipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS so_equipments_select_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_select_policy ON public.service_order_equipments
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS so_equipments_insert_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_insert_policy ON public.service_order_equipments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS so_equipments_update_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_update_policy ON public.service_order_equipments
  FOR UPDATE TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id))
  WITH CHECK (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS so_equipments_delete_policy ON public.service_order_equipments;
CREATE POLICY so_equipments_delete_policy ON public.service_order_equipments
  FOR DELETE TO authenticated
  USING (public.is_company_admin_or_manager(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_order_equipments TO authenticated;

COMMIT;
