-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Rollback 008: Restauração da arquitetura anterior à Migração 008
-- ============================================================================

-- 1. Restaurar políticas de RLS anteriores
DROP POLICY IF EXISTS platform_support_update_policy ON public.platform_support_sessions;
DROP POLICY IF EXISTS platform_support_insert_policy ON public.platform_support_sessions;
DROP POLICY IF EXISTS platform_support_select_policy ON public.platform_support_sessions;
DROP TABLE IF EXISTS public.platform_support_sessions CASCADE;

DROP POLICY IF EXISTS so_items_update_policy ON public.service_order_items;
CREATE POLICY so_items_update_policy ON public.service_order_items
  FOR UPDATE TO authenticated
  USING (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_manager(company_id)
      OR created_by = auth.uid()
      OR item_status = 'authorized'
    )
  )
  WITH CHECK (
    public.can_access_service_order(service_order_id, company_id)
    AND (
      public.is_company_manager(company_id)
      OR created_by = auth.uid()
      OR item_status = 'applied'
    )
  );

DROP POLICY IF EXISTS service_orders_update_policy ON public.service_orders;
DROP POLICY IF EXISTS service_orders_insert_policy ON public.service_orders;
DROP POLICY IF EXISTS service_orders_select_policy ON public.service_orders;

CREATE POLICY service_orders_select_policy ON public.service_orders
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(id, company_id));

CREATE POLICY service_orders_insert_policy ON public.service_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

CREATE POLICY service_orders_update_policy ON public.service_orders
  FOR UPDATE TO authenticated
  USING (public.can_access_service_order(id, company_id))
  WITH CHECK (
    public.is_company_manager(company_id)
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

DROP POLICY IF EXISTS equipments_update_policy ON public.equipments;
DROP POLICY IF EXISTS equipments_insert_policy ON public.equipments;
CREATE POLICY equipments_insert_policy ON public.equipments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));
CREATE POLICY equipments_update_policy ON public.equipments
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS clients_update_policy ON public.clients;
DROP POLICY IF EXISTS clients_insert_policy ON public.clients;
CREATE POLICY clients_insert_policy ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));
CREATE POLICY clients_update_policy ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

-- 2. Restaurar funções de segurança anteriores
DROP FUNCTION IF EXISTS public.resolve_employee_identifier(text, text);
DROP FUNCTION IF EXISTS public.is_company_admin_or_manager(uuid);
DROP FUNCTION IF EXISTS public.has_active_support_session(uuid);

CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.is_active = true
       AND c.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_manager(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1
      FROM public.company_memberships cm
      JOIN public.companies c ON c.id = cm.company_id
     WHERE cm.company_id = p_company_id
       AND cm.user_id = auth.uid()
       AND cm.role = 'manager'
       AND cm.is_active = true
       AND c.is_active = true
  );
$$;

-- 3. Remover colunas e constraints adicionadas
ALTER TABLE public.company_memberships
  DROP CONSTRAINT IF EXISTS company_memberships_company_id_username_key;
DROP INDEX IF EXISTS idx_company_memberships_username;
ALTER TABLE public.company_memberships
  DROP COLUMN IF EXISTS username;
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS must_change_password;
