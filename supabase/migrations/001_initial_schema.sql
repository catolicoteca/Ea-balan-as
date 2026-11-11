-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Etapa 1: Estrutura Multiempresa, Autenticação, Permissões (RLS),
--          Cadastros Base, Ordens de Serviço e Preparação para Execução
-- ============================================================================

-- Nota: gen_random_uuid() é nativo no PostgreSQL 13+ (Supabase Postgres 15/16/17).

-- ----------------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS (DOMÍNIO)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('manager', 'technician');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'os_status') THEN
    CREATE TYPE public.os_status AS ENUM (
      'open',
      'scheduled',
      'in_progress',
      'completed',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'os_priority') THEN
    CREATE TYPE public.os_priority AS ENUM ('low', 'medium', 'high', 'urgent');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'os_type') THEN
    CREATE TYPE public.os_type AS ENUM (
      'preventive',
      'corrective',
      'calibration',
      'installation',
      'inspection'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'equipment_status') THEN
    CREATE TYPE public.equipment_status AS ENUM (
      'active',
      'maintenance',
      'inactive',
      'condemned'
    );
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. FUNÇÃO UTILITÁRIA DE UPDATED_AT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. TABELAS DE EMPRESAS, USUÁRIOS E VÍNCULOS MULTI-TENANT
-- ----------------------------------------------------------------------------

-- 3.1 Empresas (Tenants)
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) >= 2),
  legal_name text,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  document_cnpj text,
  email text,
  phone text,
  logo_url text,
  sidebar_color text NOT NULL DEFAULT '#0B2545' CHECK (sidebar_color ~ '^#[0-9A-Fa-f]{6}$'),
  primary_color text NOT NULL DEFAULT '#0D9488' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text NOT NULL DEFAULT '#14B8A6' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  os_counter integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.2 Perfis de Usuário (espelho seguro de auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text,
  avatar_url text,
  default_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.3 Administradores da Plataforma SaaS
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3.4 Vínculos Usuário <-> Empresa (Gestor ou Técnico)
CREATE TABLE IF NOT EXISTS public.company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_membership UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_memberships_user ON public.company_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_company_memberships_company ON public.company_memberships(company_id);

-- ----------------------------------------------------------------------------
-- 4. CLIENTES E UNIDADES / ENDEREÇOS
-- ----------------------------------------------------------------------------

-- 4.1 Clientes
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) >= 2),
  trade_name text,
  document_type text NOT NULL DEFAULT 'CNPJ' CHECK (document_type IN ('CNPJ', 'CPF', 'OUTRO')),
  document_number text,
  state_registration text,
  contact_name text,
  email text,
  phone text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_clients_id_company UNIQUE (id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_clients_company ON public.clients(company_id);
CREATE INDEX IF NOT EXISTS idx_clients_search ON public.clients(company_id, name);

-- 4.2 Unidades e Endereços de Clientes
CREATE TABLE IF NOT EXISTS public.client_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  unit_name text NOT NULL CHECK (char_length(btrim(unit_name)) >= 2),
  unit_code text,
  street text NOT NULL,
  street_number text,
  complement text,
  neighborhood text,
  city text NOT NULL,
  state text NOT NULL CHECK (char_length(btrim(state)) = 2),
  postal_code text,
  reference_point text,
  contact_name text,
  contact_phone text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_units_id_company UNIQUE (id, company_id),
  CONSTRAINT fk_client_units_client_tenant
    FOREIGN KEY (client_id, company_id)
    REFERENCES public.clients(id, company_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_units_company_client ON public.client_units(company_id, client_id);

-- ----------------------------------------------------------------------------
-- 5. EQUIPAMENTOS (BALANÇAS E INSTRUMENTOS DE PESAGEM)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  unit_id uuid,
  equipment_type text NOT NULL DEFAULT 'Balança Eletrônica',
  brand text NOT NULL CHECK (char_length(btrim(brand)) >= 1),
  model text NOT NULL CHECK (char_length(btrim(model)) >= 1),
  serial_number text NOT NULL CHECK (char_length(btrim(serial_number)) >= 1),
  asset_tag text,
  inmetro_number text,
  seal_number text,
  accuracy_class text CHECK (accuracy_class IS NULL OR accuracy_class IN ('I', 'II', 'III', 'IIII', 'N/A')),
  capacity_label text,
  division_label text,
  sector_location text,
  last_calibration_date date,
  next_calibration_date date,
  status public.equipment_status NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_equipments_id_company UNIQUE (id, company_id),
  CONSTRAINT uq_equipments_company_serial UNIQUE (company_id, serial_number),
  CONSTRAINT fk_equipments_client_tenant
    FOREIGN KEY (client_id, company_id)
    REFERENCES public.clients(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_equipments_unit_tenant
    FOREIGN KEY (unit_id, company_id)
    REFERENCES public.client_units(id, company_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_equipments_company ON public.equipments(company_id);
CREATE INDEX IF NOT EXISTS idx_equipments_client ON public.equipments(company_id, client_id);

-- ----------------------------------------------------------------------------
-- 6. TÉCNICOS E CONVITES DE EMPRESA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) >= 2),
  email text,
  phone text,
  document_cpf text,
  registration_code text,
  specialties text[] NOT NULL DEFAULT '{}',
  calendar_color text NOT NULL DEFAULT '#0D9488' CHECK (calendar_color ~ '^#[0-9A-Fa-f]{6}$'),
  can_view_all_company_os boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_technicians_id_company UNIQUE (id, company_id),
  CONSTRAINT uq_technicians_company_user UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_technicians_company ON public.technicians(company_id);
CREATE INDEX IF NOT EXISTS idx_technicians_user ON public.technicians(user_id);

CREATE TABLE IF NOT EXISTS public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(btrim(email)) >= 5),
  full_name text,
  role public.app_role NOT NULL,
  technician_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_invitation_technician_tenant
    FOREIGN KEY (technician_id, company_id)
    REFERENCES public.technicians(id, company_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_company_invitations_email ON public.company_invitations(lower(email), status);

-- ----------------------------------------------------------------------------
-- 7. ORDENS DE SERVIÇO E ATRIBUIÇÕES DE TÉCNICOS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL,
  order_number text NOT NULL,
  client_id uuid NOT NULL,
  unit_id uuid,
  equipment_id uuid,
  primary_technician_id uuid,
  order_type public.os_type NOT NULL DEFAULT 'corrective',
  status public.os_status NOT NULL DEFAULT 'open',
  priority public.os_priority NOT NULL DEFAULT 'medium',
  title text NOT NULL CHECK (char_length(btrim(title)) >= 3),
  reported_issue text NOT NULL CHECK (char_length(btrim(reported_issue)) >= 3),
  internal_notes text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  allow_company_technicians_view boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_orders_id_company UNIQUE (id, company_id),
  CONSTRAINT uq_service_orders_company_number UNIQUE (company_id, order_number),
  CONSTRAINT chk_schedule_range CHECK (
    scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end >= scheduled_start
  ),
  CONSTRAINT fk_os_client_tenant
    FOREIGN KEY (client_id, company_id)
    REFERENCES public.clients(id, company_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_os_unit_tenant
    FOREIGN KEY (unit_id, company_id)
    REFERENCES public.client_units(id, company_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_os_equipment_tenant
    FOREIGN KEY (equipment_id, company_id)
    REFERENCES public.equipments(id, company_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_os_primary_technician_tenant
    FOREIGN KEY (primary_technician_id, company_id)
    REFERENCES public.technicians(id, company_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_service_orders_company_status ON public.service_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_service_orders_company_schedule ON public.service_orders(company_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_service_orders_primary_tech ON public.service_orders(company_id, primary_technician_id);

-- 8. Atribuições de Técnicos (N:N por Ordem de Serviço)
CREATE TABLE IF NOT EXISTS public.service_order_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL,
  technician_id uuid NOT NULL,
  assignment_role text NOT NULL DEFAULT 'lead' CHECK (assignment_role IN ('lead', 'assistant', 'reviewer')),
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  CONSTRAINT uq_os_assignment UNIQUE (service_order_id, technician_id),
  CONSTRAINT fk_assignment_os_tenant
    FOREIGN KEY (service_order_id, company_id)
    REFERENCES public.service_orders(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_assignment_tech_tenant
    FOREIGN KEY (technician_id, company_id)
    REFERENCES public.technicians(id, company_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_os_assignments_tech ON public.service_order_assignments(company_id, technician_id, is_active);
CREATE INDEX IF NOT EXISTS idx_os_assignments_os ON public.service_order_assignments(service_order_id, is_active);

-- ----------------------------------------------------------------------------
-- 9. ESTRUTURA PREPARADA PARA EXECUÇÃO EM CAMPO (PRÓXIMAS ETAPAS)
-- ----------------------------------------------------------------------------

-- 9.1 Registros de Execução Técnica
CREATE TABLE IF NOT EXISTS public.service_order_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL,
  technician_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  checkin_latitude numeric(10, 7),
  checkin_longitude numeric(10, 7),
  diagnosis text,
  performed_services text,
  parts_replaced jsonb NOT NULL DEFAULT '[]'::jsonb,
  calibration_measurements jsonb NOT NULL DEFAULT '{}'::jsonb,
  removed_seal_number text,
  applied_seal_number text,
  equipment_approved boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_os_executions_id_company UNIQUE (id, company_id),
  CONSTRAINT fk_execution_os_tenant
    FOREIGN KEY (service_order_id, company_id)
    REFERENCES public.service_orders(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_execution_tech_tenant
    FOREIGN KEY (technician_id, company_id)
    REFERENCES public.technicians(id, company_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_os_executions_os ON public.service_order_executions(company_id, service_order_id);

-- 9.2 Fotos e Anexos
CREATE TABLE IF NOT EXISTS public.service_order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL,
  execution_id uuid,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attachment_type text NOT NULL DEFAULT 'photo' CHECK (
    attachment_type IN ('photo_before', 'photo_after', 'seal_photo', 'certificate', 'document', 'photo')
  ),
  storage_bucket text NOT NULL DEFAULT 'os-attachments',
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_attachment_os_tenant
    FOREIGN KEY (service_order_id, company_id)
    REFERENCES public.service_orders(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_attachment_execution_tenant
    FOREIGN KEY (execution_id, company_id)
    REFERENCES public.service_order_executions(id, company_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_os_attachments_os ON public.service_order_attachments(company_id, service_order_id);

-- 9.3 Assinaturas Digitais (Cliente / Técnico)
CREATE TABLE IF NOT EXISTS public.service_order_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL,
  execution_id uuid,
  signer_type text NOT NULL CHECK (signer_type IN ('client', 'technician')),
  signer_name text NOT NULL,
  signer_document text,
  signer_role_label text,
  storage_bucket text NOT NULL DEFAULT 'os-signatures',
  signature_file_path text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_signature_os_tenant
    FOREIGN KEY (service_order_id, company_id)
    REFERENCES public.service_orders(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_signature_execution_tenant
    FOREIGN KEY (execution_id, company_id)
    REFERENCES public.service_order_executions(id, company_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_os_signatures_os ON public.service_order_signatures(company_id, service_order_id);

-- 9.4 Histórico de Alterações (Trilha de Auditoria da OS)
CREATE TABLE IF NOT EXISTS public.service_order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  old_status public.os_status,
  new_status public.os_status,
  description text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_history_os_tenant
    FOREIGN KEY (service_order_id, company_id)
    REFERENCES public.service_orders(id, company_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_os_history_os ON public.service_order_history(company_id, service_order_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 10. TRIGGERS DE AUTOMAÇÃO, NUMERAÇÃO SEQUENCIAL E HISTÓRICO
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_company_memberships_updated_at ON public.company_memberships;
CREATE TRIGGER trg_company_memberships_updated_at
  BEFORE UPDATE ON public.company_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_client_units_updated_at ON public.client_units;
CREATE TRIGGER trg_client_units_updated_at
  BEFORE UPDATE ON public.client_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_equipments_updated_at ON public.equipments;
CREATE TRIGGER trg_equipments_updated_at
  BEFORE UPDATE ON public.equipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_technicians_updated_at ON public.technicians;
CREATE TRIGGER trg_technicians_updated_at
  BEFORE UPDATE ON public.technicians
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_service_orders_updated_at ON public.service_orders;
CREATE TRIGGER trg_service_orders_updated_at
  BEFORE UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_os_executions_updated_at ON public.service_order_executions;
CREATE TRIGGER trg_os_executions_updated_at
  BEFORE UPDATE ON public.service_order_executions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10.1 Numeração automática e atômica de OS por empresa (ex: OS-2026-0001)
CREATE OR REPLACE FUNCTION public.assign_service_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_seq integer;
  v_year text;
BEGIN
  UPDATE public.companies
     SET os_counter = os_counter + 1
   WHERE id = NEW.company_id
  RETURNING os_counter INTO v_next_seq;

  IF v_next_seq IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida para numeração de Ordem de Serviço';
  END IF;

  v_year := to_char(COALESCE(NEW.created_at, now()), 'YYYY');
  NEW.sequence_number := v_next_seq;

  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := 'OS-' || v_year || '-' || lpad(v_next_seq::text, 4, '0');
  END IF;

  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  -- Se já nasce com data agendada e status 'open', promove automaticamente para 'scheduled'
  IF NEW.scheduled_start IS NOT NULL AND NEW.status = 'open' THEN
    NEW.status := 'scheduled';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_service_order_number ON public.service_orders;
CREATE TRIGGER trg_assign_service_order_number
  BEFORE INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_service_order_number();

-- 10.2 Sincroniza técnico principal em service_order_assignments + histórico
CREATE OR REPLACE FUNCTION public.after_service_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.service_order_history (
      company_id,
      service_order_id,
      actor_user_id,
      event_type,
      old_status,
      new_status,
      description,
      payload
    ) VALUES (
      NEW.company_id,
      NEW.id,
      COALESCE(auth.uid(), NEW.created_by),
      'created',
      NULL,
      NEW.status,
      'Ordem de serviço ' || NEW.order_number || ' aberta.',
      jsonb_build_object(
        'priority', NEW.priority,
        'order_type', NEW.order_type,
        'scheduled_start', NEW.scheduled_start
      )
    );

    IF NEW.primary_technician_id IS NOT NULL THEN
      INSERT INTO public.service_order_assignments (
        company_id,
        service_order_id,
        technician_id,
        assignment_role,
        is_active,
        assigned_by
      ) VALUES (
        NEW.company_id,
        NEW.id,
        NEW.primary_technician_id,
        'lead',
        true,
        COALESCE(auth.uid(), NEW.created_by)
      )
      ON CONFLICT (service_order_id, technician_id)
      DO UPDATE SET is_active = true, assignment_role = 'lead';
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.service_order_history (
        company_id,
        service_order_id,
        actor_user_id,
        event_type,
        old_status,
        new_status,
        description,
        payload
      ) VALUES (
        NEW.company_id,
        NEW.id,
        auth.uid(),
        'status_changed',
        OLD.status,
        NEW.status,
        'Status alterado de ' || OLD.status || ' para ' || NEW.status || '.',
        jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status)
      );
    END IF;

    IF OLD.scheduled_start IS DISTINCT FROM NEW.scheduled_start THEN
      INSERT INTO public.service_order_history (
        company_id,
        service_order_id,
        actor_user_id,
        event_type,
        old_status,
        new_status,
        description,
        payload
      ) VALUES (
        NEW.company_id,
        NEW.id,
        auth.uid(),
        'schedule_updated',
        OLD.status,
        NEW.status,
        'Agendamento atualizado.',
        jsonb_build_object(
          'old_scheduled_start', OLD.scheduled_start,
          'new_scheduled_start', NEW.scheduled_start
        )
      );
    END IF;

    IF OLD.primary_technician_id IS DISTINCT FROM NEW.primary_technician_id AND NEW.primary_technician_id IS NOT NULL THEN
      INSERT INTO public.service_order_assignments (
        company_id,
        service_order_id,
        technician_id,
        assignment_role,
        is_active,
        assigned_by
      ) VALUES (
        NEW.company_id,
        NEW.id,
        NEW.primary_technician_id,
        'lead',
        true,
        auth.uid()
      )
      ON CONFLICT (service_order_id, technician_id)
      DO UPDATE SET is_active = true, assignment_role = 'lead';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_service_order_change ON public.service_orders;
CREATE TRIGGER trg_after_service_order_change
  AFTER INSERT OR UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.after_service_order_change();

-- 10.3 Registra atribuições no histórico da OS
CREATE OR REPLACE FUNCTION public.after_assignment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tech_name text;
BEGIN
  SELECT full_name INTO v_tech_name
    FROM public.technicians
   WHERE id = NEW.technician_id AND company_id = NEW.company_id;

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.is_active = false AND NEW.is_active = true) THEN
    INSERT INTO public.service_order_history (
      company_id,
      service_order_id,
      actor_user_id,
      event_type,
      description,
      payload
    ) VALUES (
      NEW.company_id,
      NEW.service_order_id,
      COALESCE(auth.uid(), NEW.assigned_by),
      'technician_assigned',
      'Técnico atribuído: ' || COALESCE(v_tech_name, NEW.technician_id::text) || '.',
      jsonb_build_object('technician_id', NEW.technician_id, 'role', NEW.assignment_role)
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.is_active = true AND NEW.is_active = false THEN
    INSERT INTO public.service_order_history (
      company_id,
      service_order_id,
      actor_user_id,
      event_type,
      description,
      payload
    ) VALUES (
      NEW.company_id,
      NEW.service_order_id,
      auth.uid(),
      'technician_unassigned',
      'Atribuição removida do técnico: ' || COALESCE(v_tech_name, NEW.technician_id::text) || '.',
      jsonb_build_object('technician_id', NEW.technician_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_assignment_change ON public.service_order_assignments;
CREATE TRIGGER trg_after_assignment_change
  AFTER INSERT OR UPDATE ON public.service_order_assignments
  FOR EACH ROW EXECUTE FUNCTION public.after_assignment_change();

-- 10.4 Criação automática de profile + vínculo de convites quando usuário se cadastra
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_inv record;
BEGIN
  v_full_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(COALESCE(NEW.email, ''), '@', 1)
  );

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE
          WHEN btrim(public.profiles.full_name) = '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END;

  IF NEW.email IS NOT NULL THEN
    -- Vincula convites pendentes por e-mail
    FOR v_inv IN
      SELECT *
        FROM public.company_invitations
       WHERE lower(email) = lower(NEW.email)
         AND status = 'pending'
    LOOP
      INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
      VALUES (v_inv.company_id, NEW.id, v_inv.role, true, v_inv.invited_by)
      ON CONFLICT (company_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            is_active = true;

      IF v_inv.technician_id IS NOT NULL THEN
        UPDATE public.technicians
           SET user_id = NEW.id
         WHERE id = v_inv.technician_id
           AND company_id = v_inv.company_id
           AND user_id IS NULL;
      ELSIF v_inv.role = 'technician' THEN
        UPDATE public.technicians
           SET user_id = NEW.id
         WHERE company_id = v_inv.company_id
           AND lower(email) = lower(NEW.email)
           AND user_id IS NULL;
      END IF;

      UPDATE public.company_invitations
         SET status = 'accepted',
             accepted_by = NEW.id,
             accepted_at = now()
       WHERE id = v_inv.id;

      UPDATE public.profiles
         SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
       WHERE id = NEW.id;
    END LOOP;

    -- Caso um gestor tenha cadastrado um técnico com este e-mail sem registro separado em invitations
    FOR v_inv IN
      SELECT id, company_id
        FROM public.technicians
       WHERE lower(email) = lower(NEW.email)
         AND user_id IS NULL
         AND is_active = true
    LOOP
      UPDATE public.technicians
         SET user_id = NEW.id
       WHERE id = v_inv.id;

      INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
      VALUES (v_inv.company_id, NEW.id, 'technician', true)
      ON CONFLICT (company_id, user_id) DO NOTHING;

      UPDATE public.profiles
         SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
       WHERE id = NEW.id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 11. FUNÇÕES DE SEGURANÇA E AUTORIZAÇÃO (SECURITY DEFINER — SEM RECURSÃO RLS)
-- ----------------------------------------------------------------------------

-- Verifica se o usuário autenticado é Administrador ativo da Plataforma
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.platform_admins pa
     WHERE pa.user_id = auth.uid()
       AND pa.is_active = true
  );
$$;

-- Verifica se o usuário pertence ativamente à empresa informada
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

-- Verifica se o usuário é Gestor da empresa informada (ou Admin da Plataforma)
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

-- Retorna o ID do registro de técnico do usuário autenticado na empresa (se ativo)
CREATE OR REPLACE FUNCTION public.current_technician_id(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
    FROM public.technicians t
    JOIN public.company_memberships cm
      ON cm.company_id = t.company_id
     AND cm.user_id = t.user_id
    JOIN public.companies c
      ON c.id = t.company_id
   WHERE t.company_id = p_company_id
     AND t.user_id = auth.uid()
     AND t.is_active = true
     AND cm.is_active = true
     AND c.is_active = true
   LIMIT 1;
$$;

-- Verifica se o técnico possui autorização explícita da empresa para ver todas as OS da própria empresa
CREATE OR REPLACE FUNCTION public.technician_has_company_os_override(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.technicians t
      JOIN public.company_memberships cm
        ON cm.company_id = t.company_id
       AND cm.user_id = t.user_id
      JOIN public.companies c
        ON c.id = t.company_id
     WHERE t.company_id = p_company_id
       AND t.user_id = auth.uid()
       AND t.is_active = true
       AND t.can_view_all_company_os = true
       AND cm.is_active = true
       AND c.is_active = true
  );
$$;

-- Regra central de visualização de Ordem de Serviço:
-- 1) Admin da plataforma ou Gestor da empresa: acesso total às OS da empresa.
-- 2) Técnico da empresa: SOMENTE se:
--    a) estiver atribuído ativamente em service_order_assignments, OU
--    b) for o primary_technician_id da OS, OU
--    c) possuir autorização explícita no cadastro do técnico (can_view_all_company_os = true), OU
--    d) a própria OS tiver autorização explícita marcada pelo gestor (allow_company_technicians_view = true).
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
                  AND so.company_id = soa.company_id
                  AND soa.technician_id = public.current_technician_id(p_company_id)
                  AND soa.is_active = true
             )
           )
      )
    );
$$;

-- Verifica se técnico pode visualizar um cliente (somente clientes vinculados a OS acessíveis a ele, ou override explícito)
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

-- Verifica se técnico pode visualizar uma unidade (somente unidades vinculadas a OS acessíveis a ele, ou override explícito)
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

-- Verifica se técnico pode visualizar um equipamento (somente equipamentos vinculados a OS acessíveis a ele, ou override explícito)
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

-- Verifica se um técnico pode visualizar os dados básicos de outro técnico (ele mesmo ou colega na mesma OS acessível)
CREATE OR REPLACE FUNCTION public.can_view_technician(p_technician_id uuid, p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_manager(p_company_id)
    OR public.technician_has_company_os_override(p_company_id)
    OR p_technician_id = public.current_technician_id(p_company_id)
    OR EXISTS (
      SELECT 1
        FROM public.service_order_assignments soa
       WHERE soa.company_id = p_company_id
         AND soa.technician_id = p_technician_id
         AND soa.is_active = true
         AND public.can_access_service_order(soa.service_order_id, p_company_id)
    );
$$;

-- ----------------------------------------------------------------------------
-- 12. FUNÇÕES RPC DE BOOTSTRAP INICIAL SEGURO E VÍNCULO DE CONVITES
-- ----------------------------------------------------------------------------

-- Helper simples para remover acentos básicos na geração de slug sem depender da extensão unaccent
CREATE OR REPLACE FUNCTION public.unaccent_fallback(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(
    p_input,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

-- Retorna se a plataforma ainda não possui nenhum Administrador (primeiro acesso da instância)
CREATE OR REPLACE FUNCTION public.is_platform_setup_needed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.platform_admins);
$$;

-- Inicialização atômica do primeiro tenant (EA Balanças) — bloqueada permanentemente após o 1º admin existir
CREATE OR REPLACE FUNCTION public.bootstrap_initial_platform(
  p_company_name text DEFAULT 'EA Balanças',
  p_document_cnpj text DEFAULT NULL,
  p_full_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_company_id uuid;
  v_slug text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória para inicializar o sistema.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins) THEN
    RAISE EXCEPTION 'A plataforma já foi inicializada por um administrador.';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    v_uid,
    COALESCE(NULLIF(btrim(p_full_name), ''), split_part(COALESCE(v_email, 'Administrador'), '@', 1)),
    COALESCE(v_email, '')
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(NULLIF(btrim(p_full_name), ''), public.profiles.full_name);

  v_slug := regexp_replace(lower(public.unaccent_fallback(COALESCE(NULLIF(btrim(p_company_name), ''), 'ea-balancas'))), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN
    v_slug := 'ea-balancas';
  END IF;

  INSERT INTO public.companies (
    name,
    legal_name,
    slug,
    document_cnpj,
    email,
    sidebar_color,
    primary_color,
    accent_color,
    created_by
  ) VALUES (
    COALESCE(NULLIF(btrim(p_company_name), ''), 'EA Balanças'),
    COALESCE(NULLIF(btrim(p_company_name), ''), 'EA Balanças Assistência Técnica Ltda'),
    v_slug,
    NULLIF(btrim(p_document_cnpj), ''),
    v_email,
    '#0B2545',
    '#0D9488',
    '#14B8A6',
    v_uid
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.platform_admins (user_id, is_active, notes, created_by)
  VALUES (v_uid, true, 'Bootstrap inicial da plataforma', v_uid);

  INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
  VALUES (v_company_id, v_uid, 'manager', true, v_uid);

  UPDATE public.profiles
     SET default_company_id = v_company_id
   WHERE id = v_uid;

  RETURN v_company_id;
END;
$$;

-- Permite que um usuário autenticado processe convites pendentes enviados ao seu e-mail
CREATE OR REPLACE FUNCTION public.claim_my_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_inv record;
  v_count integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_inv IN
    SELECT *
      FROM public.company_invitations
     WHERE lower(email) = lower(v_email)
       AND status = 'pending'
  LOOP
    INSERT INTO public.company_memberships (company_id, user_id, role, is_active, invited_by)
    VALUES (v_inv.company_id, v_uid, v_inv.role, true, v_inv.invited_by)
    ON CONFLICT (company_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_active = true;

    IF v_inv.technician_id IS NOT NULL THEN
      UPDATE public.technicians
         SET user_id = v_uid
       WHERE id = v_inv.technician_id
         AND company_id = v_inv.company_id
         AND (user_id IS NULL OR user_id = v_uid);
    ELSIF v_inv.role = 'technician' THEN
      UPDATE public.technicians
         SET user_id = v_uid
       WHERE company_id = v_inv.company_id
         AND lower(email) = lower(v_email)
         AND (user_id IS NULL OR user_id = v_uid);
    END IF;

    UPDATE public.company_invitations
       SET status = 'accepted',
           accepted_by = v_uid,
           accepted_at = now()
     WHERE id = v_inv.id;

    UPDATE public.profiles
       SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
     WHERE id = v_uid;

    v_count := v_count + 1;
  END LOOP;

  -- Também vincula cadastros diretos de técnicos feitos pelo gestor com o mesmo e-mail
  FOR v_inv IN
    SELECT id, company_id
      FROM public.technicians
     WHERE lower(email) = lower(v_email)
       AND user_id IS NULL
       AND is_active = true
  LOOP
    UPDATE public.technicians
       SET user_id = v_uid
     WHERE id = v_inv.id;

    INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
    VALUES (v_inv.company_id, v_uid, 'technician', true)
    ON CONFLICT (company_id, user_id) DO NOTHING;

    UPDATE public.profiles
       SET default_company_id = COALESCE(default_company_id, v_inv.company_id)
     WHERE id = v_uid;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_setup_needed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_platform(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_invitations() TO authenticated;

-- ----------------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS DE NEGÓCIO E IDENTIDADE
-- ----------------------------------------------------------------------------

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_order_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_order_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_order_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_order_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_order_history ENABLE ROW LEVEL SECURITY;

-- 13.1 Políticas: companies
DROP POLICY IF EXISTS companies_select_policy ON public.companies;
CREATE POLICY companies_select_policy ON public.companies
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
        FROM public.company_memberships cm
       WHERE cm.company_id = companies.id
         AND cm.user_id = auth.uid()
         AND cm.is_active = true
    )
  );

DROP POLICY IF EXISTS companies_insert_policy ON public.companies;
CREATE POLICY companies_insert_policy ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS companies_update_policy ON public.companies;
CREATE POLICY companies_update_policy ON public.companies
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(id))
  WITH CHECK (public.is_company_manager(id));

DROP POLICY IF EXISTS companies_delete_policy ON public.companies;
CREATE POLICY companies_delete_policy ON public.companies
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- 13.2 Políticas: profiles
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_platform_admin()
    OR EXISTS (
      SELECT 1
        FROM public.company_memberships my_cm
        JOIN public.company_memberships their_cm
          ON their_cm.company_id = my_cm.company_id
       WHERE my_cm.user_id = auth.uid()
         AND my_cm.is_active = true
         AND my_cm.role = 'manager'
         AND their_cm.user_id = profiles.id
    )
  );

DROP POLICY IF EXISTS profiles_insert_policy ON public.profiles;
CREATE POLICY profiles_insert_policy ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (id = auth.uid() OR public.is_platform_admin());

-- 13.3 Políticas: platform_admins
DROP POLICY IF EXISTS platform_admins_select_policy ON public.platform_admins;
CREATE POLICY platform_admins_select_policy ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS platform_admins_manage_policy ON public.platform_admins;
CREATE POLICY platform_admins_manage_policy ON public.platform_admins
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 13.4 Políticas: company_memberships
DROP POLICY IF EXISTS memberships_select_policy ON public.company_memberships;
CREATE POLICY memberships_select_policy ON public.company_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_company_manager(company_id)
  );

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

-- 13.5 Políticas: company_invitations
DROP POLICY IF EXISTS invitations_select_policy ON public.company_invitations;
CREATE POLICY invitations_select_policy ON public.company_invitations
  FOR SELECT TO authenticated
  USING (public.is_company_manager(company_id));

DROP POLICY IF EXISTS invitations_insert_policy ON public.company_invitations;
CREATE POLICY invitations_insert_policy ON public.company_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS invitations_update_policy ON public.company_invitations;
CREATE POLICY invitations_update_policy ON public.company_invitations
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS invitations_delete_policy ON public.company_invitations;
CREATE POLICY invitations_delete_policy ON public.company_invitations
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.6 Políticas: clients
DROP POLICY IF EXISTS clients_select_policy ON public.clients;
CREATE POLICY clients_select_policy ON public.clients
  FOR SELECT TO authenticated
  USING (public.can_view_client(id, company_id));

DROP POLICY IF EXISTS clients_insert_policy ON public.clients;
CREATE POLICY clients_insert_policy ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS clients_update_policy ON public.clients;
CREATE POLICY clients_update_policy ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS clients_delete_policy ON public.clients;
CREATE POLICY clients_delete_policy ON public.clients
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.7 Políticas: client_units
DROP POLICY IF EXISTS client_units_select_policy ON public.client_units;
CREATE POLICY client_units_select_policy ON public.client_units
  FOR SELECT TO authenticated
  USING (public.can_view_client_unit(id, company_id));

DROP POLICY IF EXISTS client_units_insert_policy ON public.client_units;
CREATE POLICY client_units_insert_policy ON public.client_units
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS client_units_update_policy ON public.client_units;
CREATE POLICY client_units_update_policy ON public.client_units
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS client_units_delete_policy ON public.client_units;
CREATE POLICY client_units_delete_policy ON public.client_units
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.8 Políticas: equipments
DROP POLICY IF EXISTS equipments_select_policy ON public.equipments;
CREATE POLICY equipments_select_policy ON public.equipments
  FOR SELECT TO authenticated
  USING (public.can_view_equipment(id, company_id));

DROP POLICY IF EXISTS equipments_insert_policy ON public.equipments;
CREATE POLICY equipments_insert_policy ON public.equipments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS equipments_update_policy ON public.equipments;
CREATE POLICY equipments_update_policy ON public.equipments
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS equipments_delete_policy ON public.equipments;
CREATE POLICY equipments_delete_policy ON public.equipments
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.9 Políticas: technicians
DROP POLICY IF EXISTS technicians_select_policy ON public.technicians;
CREATE POLICY technicians_select_policy ON public.technicians
  FOR SELECT TO authenticated
  USING (public.can_view_technician(id, company_id));

DROP POLICY IF EXISTS technicians_insert_policy ON public.technicians;
CREATE POLICY technicians_insert_policy ON public.technicians
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS technicians_update_policy ON public.technicians;
CREATE POLICY technicians_update_policy ON public.technicians
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS technicians_delete_policy ON public.technicians;
CREATE POLICY technicians_delete_policy ON public.technicians
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.10 Políticas: service_orders
DROP POLICY IF EXISTS service_orders_select_policy ON public.service_orders;
CREATE POLICY service_orders_select_policy ON public.service_orders
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(id, company_id));

DROP POLICY IF EXISTS service_orders_insert_policy ON public.service_orders;
CREATE POLICY service_orders_insert_policy ON public.service_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS service_orders_update_policy ON public.service_orders;
CREATE POLICY service_orders_update_policy ON public.service_orders
  FOR UPDATE TO authenticated
  USING (public.can_access_service_order(id, company_id))
  WITH CHECK (
    public.is_company_manager(company_id)
    OR (
      -- Técnicos atribuídos só podem atualizar OS atribuídas a eles na mesma empresa
      public.current_technician_id(company_id) IS NOT NULL
      AND (
        primary_technician_id = public.current_technician_id(company_id)
        OR EXISTS (
          SELECT 1
            FROM public.service_order_assignments soa
           WHERE soa.service_order_id = service_orders.id
             AND soa.company_id = service_orders.company_id
             AND soa.technician_id = public.current_technician_id(service_orders.company_id)
             AND soa.is_active = true
        )
      )
    )
  );

DROP POLICY IF EXISTS service_orders_delete_policy ON public.service_orders;
CREATE POLICY service_orders_delete_policy ON public.service_orders
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.11 Políticas: service_order_assignments
DROP POLICY IF EXISTS assignments_select_policy ON public.service_order_assignments;
CREATE POLICY assignments_select_policy ON public.service_order_assignments
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS assignments_insert_policy ON public.service_order_assignments;
CREATE POLICY assignments_insert_policy ON public.service_order_assignments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS assignments_update_policy ON public.service_order_assignments;
CREATE POLICY assignments_update_policy ON public.service_order_assignments
  FOR UPDATE TO authenticated
  USING (public.is_company_manager(company_id))
  WITH CHECK (public.is_company_manager(company_id));

DROP POLICY IF EXISTS assignments_delete_policy ON public.service_order_assignments;
CREATE POLICY assignments_delete_policy ON public.service_order_assignments
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.12 Políticas: service_order_executions (preparado para Etapa 2)
DROP POLICY IF EXISTS executions_select_policy ON public.service_order_executions;
CREATE POLICY executions_select_policy ON public.service_order_executions
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS executions_insert_policy ON public.service_order_executions;
CREATE POLICY executions_insert_policy ON public.service_order_executions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_manager(company_id)
    OR (
      technician_id = public.current_technician_id(company_id)
      AND public.can_access_service_order(service_order_id, company_id)
    )
  );

DROP POLICY IF EXISTS executions_update_policy ON public.service_order_executions;
CREATE POLICY executions_update_policy ON public.service_order_executions
  FOR UPDATE TO authenticated
  USING (
    public.is_company_manager(company_id)
    OR (
      technician_id = public.current_technician_id(company_id)
      AND public.can_access_service_order(service_order_id, company_id)
    )
  )
  WITH CHECK (
    public.is_company_manager(company_id)
    OR (
      technician_id = public.current_technician_id(company_id)
      AND public.can_access_service_order(service_order_id, company_id)
    )
  );

DROP POLICY IF EXISTS executions_delete_policy ON public.service_order_executions;
CREATE POLICY executions_delete_policy ON public.service_order_executions
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.13 Políticas: service_order_attachments (preparado para Etapa 2)
DROP POLICY IF EXISTS attachments_select_policy ON public.service_order_attachments;
CREATE POLICY attachments_select_policy ON public.service_order_attachments
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS attachments_insert_policy ON public.service_order_attachments;
CREATE POLICY attachments_insert_policy ON public.service_order_attachments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS attachments_delete_policy ON public.service_order_attachments;
CREATE POLICY attachments_delete_policy ON public.service_order_attachments
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.14 Políticas: service_order_signatures (preparado para Etapa 2)
DROP POLICY IF EXISTS signatures_select_policy ON public.service_order_signatures;
CREATE POLICY signatures_select_policy ON public.service_order_signatures
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS signatures_insert_policy ON public.service_order_signatures;
CREATE POLICY signatures_insert_policy ON public.service_order_signatures
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS signatures_delete_policy ON public.service_order_signatures;
CREATE POLICY signatures_delete_policy ON public.service_order_signatures
  FOR DELETE TO authenticated
  USING (public.is_company_manager(company_id));

-- 13.15 Políticas: service_order_history
DROP POLICY IF EXISTS history_select_policy ON public.service_order_history;
CREATE POLICY history_select_policy ON public.service_order_history
  FOR SELECT TO authenticated
  USING (public.can_access_service_order(service_order_id, company_id));

DROP POLICY IF EXISTS history_insert_policy ON public.service_order_history;
CREATE POLICY history_insert_policy ON public.service_order_history
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_service_order(service_order_id, company_id));

-- ----------------------------------------------------------------------------
-- 14. SUPABASE STORAGE BUCKETS & POLICIES (LOGOTIPOS, ANEXOS E ASSINATURAS)
-- ----------------------------------------------------------------------------
-- Convenção obrigatória de caminho em todos os buckets:
--   {company_id}/{arquivo_ou_subpasta}
-- O primeiro diretório (storage.foldername(name))[1] identifica o tenant!

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES
      ('company-assets', 'company-assets', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
      ('os-attachments', 'os-attachments', false, 15728640, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
      ('os-signatures', 'os-signatures', false, 2097152, ARRAY['image/png', 'image/svg+xml'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    -- Logotipos públicos para leitura, escrita restrita ao Gestor da própria empresa
    EXECUTE 'DROP POLICY IF EXISTS company_assets_read ON storage.objects';
    EXECUTE $pol$
      CREATE POLICY company_assets_read ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'company-assets')
    $pol$;

    EXECUTE 'DROP POLICY IF EXISTS company_assets_write ON storage.objects';
    EXECUTE $pol$
      CREATE POLICY company_assets_write ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'company-assets'
          AND (split_part(name, '/', 1)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND public.is_company_manager((split_part(name, '/', 1))::uuid)
        )
    $pol$;

    EXECUTE 'DROP POLICY IF EXISTS company_assets_update ON storage.objects';
    EXECUTE $pol$
      CREATE POLICY company_assets_update ON storage.objects
        FOR UPDATE TO authenticated
        USING (
          bucket_id = 'company-assets'
          AND (split_part(name, '/', 1)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND public.is_company_manager((split_part(name, '/', 1))::uuid)
        )
    $pol$;

    EXECUTE 'DROP POLICY IF EXISTS company_assets_delete ON storage.objects';
    EXECUTE $pol$
      CREATE POLICY company_assets_delete ON storage.objects
        FOR DELETE TO authenticated
        USING (
          bucket_id = 'company-assets'
          AND (split_part(name, '/', 1)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND public.is_company_manager((split_part(name, '/', 1))::uuid)
        )
    $pol$;

    -- Anexos e Assinaturas de OS: caminho {company_id}/{service_order_id}/{arquivo}
    EXECUTE 'DROP POLICY IF EXISTS os_files_select ON storage.objects';
    EXECUTE $pol$
      CREATE POLICY os_files_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id IN ('os-attachments', 'os-signatures')
          AND (split_part(name, '/', 1)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (split_part(name, '/', 2)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND public.can_access_service_order(
            (split_part(name, '/', 2))::uuid,
            (split_part(name, '/', 1))::uuid
          )
        )
    $pol$;

    EXECUTE 'DROP POLICY IF EXISTS os_files_insert ON storage.objects';
    EXECUTE $pol$
      CREATE POLICY os_files_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id IN ('os-attachments', 'os-signatures')
          AND (split_part(name, '/', 1)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (split_part(name, '/', 2)) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND public.can_access_service_order(
            (split_part(name, '/', 2))::uuid,
            (split_part(name, '/', 1))::uuid
          )
        )
    $pol$;
  END IF;
END
$$;

-- Permissões de acesso às tabelas para o papel autenticado (filtradas 100% pelo RLS acima)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
