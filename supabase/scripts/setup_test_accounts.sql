-- ============================================================================
-- EA Balanças — Sistema SaaS de Assistência Técnica em Campo (Multi-tenant)
-- Script 005: Configuração de Contas Oficiais de Teste e OS de Demonstração
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_company_ea uuid;
  v_company_b uuid;
  v_gestor_id uuid;
  v_tecnico_id uuid;
  v_tech_record_id uuid;
  v_client_id uuid;
  v_unit_id uuid;
  v_equip_id uuid;
  v_os_id uuid;
  v_user_b_id uuid;
BEGIN
  -- 1. Obtém ID da EA Balanças
  SELECT id INTO v_company_ea FROM public.companies WHERE slug = 'ea-balancas' LIMIT 1;
  IF v_company_ea IS NULL THEN
    RAISE EXCEPTION 'A empresa EA Balanças não foi encontrada. Execute a migração 004 primeiro.';
  END IF;

  -- 2. Cria Usuário Gestor (gestor@eabalancas.com.br / EaBalan@2026)
  SELECT id INTO v_gestor_id FROM auth.users WHERE email = 'gestor@eabalancas.com.br' LIMIT 1;
  IF v_gestor_id IS NULL THEN
    v_gestor_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
    ) VALUES (
      v_gestor_id, '00000000-0000-0000-0000-000000000000', 'gestor@eabalancas.com.br',
      extensions.crypt('EaBalan@2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"Carlos Eduardo (Gestor)"}',
      now(), now(), 'authenticated', 'authenticated'
    );
  ELSE
    UPDATE auth.users
       SET encrypted_password = extensions.crypt('EaBalan@2026', extensions.gen_salt('bf')),
           email_confirmed_at = now()
     WHERE id = v_gestor_id;
  END IF;

  -- Vincula Gestor como Manager na EA Balanças
  INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
  VALUES (v_company_ea, v_gestor_id, 'manager', true)
  ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'manager', is_active = true;

  -- 3. Cria Usuário Técnico (tecnico@eabalancas.com.br / EaBalan@2026)
  SELECT id INTO v_tecnico_id FROM auth.users WHERE email = 'tecnico@eabalancas.com.br' LIMIT 1;
  IF v_tecnico_id IS NULL THEN
    v_tecnico_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
    ) VALUES (
      v_tecnico_id, '00000000-0000-0000-0000-000000000000', 'tecnico@eabalancas.com.br',
      extensions.crypt('EaBalan@2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"Roberto Silva (Técnico de Campo)"}',
      now(), now(), 'authenticated', 'authenticated'
    );
  ELSE
    UPDATE auth.users
       SET encrypted_password = extensions.crypt('EaBalan@2026', extensions.gen_salt('bf')),
           email_confirmed_at = now()
     WHERE id = v_tecnico_id;
  END IF;

  -- Vincula Técnico em company_memberships
  INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
  VALUES (v_company_ea, v_tecnico_id, 'technician', true)
  ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'technician', is_active = true;

  -- Vincula na tabela technicians
  SELECT id INTO v_tech_record_id FROM public.technicians WHERE user_id = v_tecnico_id AND company_id = v_company_ea LIMIT 1;
  IF v_tech_record_id IS NULL THEN
    INSERT INTO public.technicians (company_id, user_id, full_name, email, phone, is_active)
    VALUES (v_company_ea, v_tecnico_id, 'Roberto Silva (Técnico de Campo)', 'tecnico@eabalancas.com.br', '(11) 98765-4321', true)
    RETURNING id INTO v_tech_record_id;
  END IF;

  -- 4. Cria Cliente e Unidade para Teste
  SELECT id INTO v_client_id FROM public.clients WHERE company_id = v_company_ea AND name = 'Supermercado Modelo Ltda' LIMIT 1;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (company_id, name, trade_name, document_type, document_number, phone, email)
    VALUES (v_company_ea, 'Supermercado Modelo Ltda', 'Supermercado Modelo', 'CNPJ', '23.456.789/0001-01', '(11) 3344-5566', 'contato@supermercadomodelo.com.br')
    RETURNING id INTO v_client_id;
  END IF;

  SELECT id INTO v_unit_id FROM public.client_units WHERE client_id = v_client_id LIMIT 1;
  IF v_unit_id IS NULL THEN
    INSERT INTO public.client_units (company_id, client_id, unit_name, street, street_number, city, state, postal_code)
    VALUES (v_company_ea, v_client_id, 'Loja Matriz - Centro', 'Av. Principal', '1000', 'São Paulo', 'SP', '01000-000')
    RETURNING id INTO v_unit_id;
  END IF;

  -- 5. Cria Equipamento (Balança Toledo Prix 4)
  SELECT id INTO v_equip_id FROM public.equipments WHERE company_id = v_company_ea AND serial_number = 'PRX4-2026-9901' LIMIT 1;
  IF v_equip_id IS NULL THEN
    INSERT INTO public.equipments (
      company_id, client_id, unit_id, brand, model, serial_number, asset_tag, capacity_label, division_label
    ) VALUES (
      v_company_ea, v_client_id, v_unit_id, 'Toledo', 'Prix 4 Flex', 'PRX4-2026-9901', 'TAG-001', '15kg', '5g'
    ) RETURNING id INTO v_equip_id;
  END IF;

  -- 6. Cria Ordem de Serviço Ativa para o Técnico
  SELECT id INTO v_os_id FROM public.service_orders WHERE company_id = v_company_ea AND title LIKE '%Toledo Prix 4%' LIMIT 1;
  IF v_os_id IS NULL THEN
    INSERT INTO public.service_orders (
      company_id, sequence_number, order_number, client_id, unit_id, equipment_id,
      primary_technician_id, order_type, status, priority, title, reported_issue, created_by
    ) VALUES (
      v_company_ea, 1, 'OS-2026-0001', v_client_id, v_unit_id, v_equip_id,
      v_tech_record_id, 'corrective', 'in_progress', 'high',
      'Manutenção Preventiva e Troca de Teclado - Toledo Prix 4',
      'Cliente relata falha nas teclas de tara e teclado desgastado.',
      v_gestor_id
    ) RETURNING id INTO v_os_id;

    -- A atribuição da OS ao técnico é criada automaticamente pelo trigger da Fase A quando primary_technician_id é informado
  END IF;

  -- 7. Cria Segunda Empresa (Empresa B) para Testar Bloqueio Multi-tenant
  SELECT id INTO v_company_b FROM public.companies WHERE slug = 'metrologia-concorrente-b' LIMIT 1;
  IF v_company_b IS NULL THEN
    INSERT INTO public.companies (
      name, slug, document_cnpj, sidebar_color, primary_color, accent_color, is_active
    ) VALUES (
      'Metrologia Concorrente B Ltda', 'metrologia-concorrente-b', '99.888.777/0001-66',
      '#1E293B', '#3B82F6', '#60A5FA', true
    ) RETURNING id INTO v_company_b;
  END IF;

  SELECT id INTO v_user_b_id FROM auth.users WHERE email = 'gestor@empresa-b.com.br' LIMIT 1;
  IF v_user_b_id IS NULL THEN
    v_user_b_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
    ) VALUES (
      v_user_b_id, '00000000-0000-0000-0000-000000000000', 'gestor@empresa-b.com.br',
      extensions.crypt('EaBalan@2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"Gestor Concorrente B"}',
      now(), now(), 'authenticated', 'authenticated'
    );
  END IF;

  INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
  VALUES (v_company_b, v_user_b_id, 'manager', true)
  ON CONFLICT (company_id, user_id) DO NOTHING;

  RAISE NOTICE 'Setup concluído com sucesso:';
  RAISE NOTICE ' - Gestor: gestor@eabalancas.com.br (Senha: EaBalan@2026)';
  RAISE NOTICE ' - Técnico: tecnico@eabalancas.com.br (Senha: EaBalan@2026)';
  RAISE NOTICE ' - Empresa B: gestor@empresa-b.com.br (Senha: EaBalan@2026)';
END $$;

COMMIT;
