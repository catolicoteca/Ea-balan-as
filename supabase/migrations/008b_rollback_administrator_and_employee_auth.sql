-- ============================================================================
-- Metrion SaaS — Assistência Técnica Profissional
-- Rollback 008b: Reversão da migração 008b (estruturas, funções e políticas)
-- ============================================================================

-- 1. Restaurar políticas de RLS anteriores
DROP POLICY IF EXISTS platform_support_update_policy ON public.platform_support_sessions;
DROP POLICY IF EXISTS platform_support_insert_policy ON public.platform_support_sessions;
DROP POLICY IF EXISTS platform_support_select_policy ON public.platform_support_sessions;
DROP TABLE IF EXISTS public.platform_support_sessions CASCADE;

-- Restaurar política de atualização de profiles
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (id = auth.uid() OR public.is_platform_admin());

-- Restaurar política de itens de OS
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

-- Restaurar políticas de service_orders
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

-- Restaurar políticas de equipamentos
DROP POLICY IF EXISTS equipments_update_policy ON public.equipments;
DROP POLICY IF EXISTS equipments_insert_policy ON public.equipments;
CREATE POLICY equipments_insert_policy ON public.equipments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));
CREATE POLICY equipments_update_policy ON public.equipments
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

-- Restaurar políticas de clientes
DROP POLICY IF EXISTS clients_update_policy ON public.clients;
DROP POLICY IF EXISTS clients_insert_policy ON public.clients;
CREATE POLICY clients_insert_policy ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));
CREATE POLICY clients_update_policy ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

-- Restaurar políticas de company_memberships
DROP POLICY IF EXISTS memberships_delete_policy ON public.company_memberships;
DROP POLICY IF EXISTS memberships_update_policy ON public.company_memberships;
DROP POLICY IF EXISTS memberships_insert_policy ON public.company_memberships;
CREATE POLICY memberships_insert_policy ON public.company_memberships
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));
CREATE POLICY memberships_update_policy ON public.company_memberships
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));
CREATE POLICY memberships_delete_policy ON public.company_memberships
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 2. Restaurar funções de segurança anteriores
DROP FUNCTION IF EXISTS public.confirm_password_changed();
DROP FUNCTION IF EXISTS public.resolve_employee_identifier(text, text);
DROP FUNCTION IF EXISTS public.is_company_admin_or_manager(uuid);
DROP FUNCTION IF EXISTS public.has_active_support_session(uuid);

CREATE OR REPLACE FUNCTION public.can_view_equipment(p_equipment_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND so.equipment_id = p_equipment_id
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
    public.is_company_manager(p_company_id)
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

CREATE OR REPLACE FUNCTION public.can_view_client(p_client_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.company_id = p_company_id
         AND so.client_id = p_client_id
         AND public.can_access_service_order(so.id, p_company_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_service_order(p_os_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_manager(p_company_id)
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
