import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Testa o arquivo real supabase/migrations/001_initial_schema.sql
 * contra uma instância real PostgreSQL (PGlite) simulando o ambiente
 * Supabase ( papéis anon / authenticated + auth.uid() + storage ).
 */
describe('PostgreSQL Multi-tenant Schema & Row Level Security (RLS)', () => {
  let db: PGlite;

  const USER_ADMIN = '11111111-1111-4111-8111-111111111111';
  const USER_MGR_A = '22222222-2222-4222-8222-222222222222';
  const USER_TECH_A1 = '33333333-3333-4333-8333-333333333333';
  const USER_TECH_A2 = '44444444-4444-4444-8444-444444444444';
  const USER_MGR_B = '55555555-5555-4555-8555-555555555555';
  const USER_OUTSIDER = '66666666-6666-4666-8666-666666666666';

  let companyEAId = '';
  let companyBId = '';
  let clientEAId = '';
  let unitEAId = '';
  let equipEAId = '';
  let techA1Id = '';
  let techA2Id = '';
  let os1Id = '';
  let os2Id = '';
  let clientBId = '';

  async function runAsUser<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    await db.exec('BEGIN');
    try {
      if (userId) {
        await db.exec(`SET LOCAL ROLE authenticated;`);
        await db.exec(
          `SELECT set_config('request.jwt.claim.sub', '${userId}', true);`
        );
      } else {
        await db.exec(`SET LOCAL ROLE anon;`);
        await db.exec(`SELECT set_config('request.jwt.claim.sub', '', true);`);
      }
      const res = await db.query<T>(sql, params);
      await db.exec('COMMIT');
      return res.rows;
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  }

  beforeAll(async () => {
    db = new PGlite();

    // Cria papéis e esquemas equivalentes ao Supabase (auth & storage)
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;

      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text UNIQUE,
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

      CREATE SCHEMA IF NOT EXISTS storage;
      GRANT USAGE ON SCHEMA storage TO anon, authenticated;

      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );

      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text REFERENCES storage.buckets(id),
        name text NOT NULL,
        owner uuid DEFAULT auth.uid(),
        created_at timestamptz DEFAULT now()
      );

      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
      GRANT SELECT ON storage.buckets TO anon, authenticated;
    `);

    const migrationSql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql'),
      'utf-8'
    );
    await db.exec(migrationSql);

    // Insere usuários de teste em auth.users (dispara trigger on_auth_user_created!)
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('${USER_ADMIN}', 'admin@eabalancas.com.br', '{"full_name": "Admin Plataforma"}'),
        ('${USER_MGR_A}', 'gestor@eabalancas.com.br', '{"full_name": "Gestor EA"}'),
        ('${USER_TECH_A1}', 'carlos.tec@eabalancas.com.br', '{"full_name": "Carlos Técnico"}'),
        ('${USER_TECH_A2}', 'marcos.tec@eabalancas.com.br', '{"full_name": "Marcos Técnico"}'),
        ('${USER_MGR_B}', 'gestor@outrotenant.com.br', '{"full_name": "Gestor Empresa B"}'),
        ('${USER_OUTSIDER}', 'visitante@externo.com.br', '{"full_name": "Visitante Sem Vínculo"}');
    `);
  });

  it('inicializa a plataforma com EA Balanças apenas para o primeiro administrador e bloqueia tentativas seguintes', async () => {
    const checkBefore = await runAsUser<{ is_platform_setup_needed: boolean }>(
      USER_ADMIN,
      'SELECT public.is_platform_setup_needed();'
    );
    expect(checkBefore[0].is_platform_setup_needed).toBe(true);

    const boot = await runAsUser<{ bootstrap_initial_platform: string }>(
      USER_ADMIN,
      `SELECT public.bootstrap_initial_platform('EA Balanças', '12.345.678/0001-90', 'Admin Plataforma');`
    );
    companyEAId = boot[0].bootstrap_initial_platform;
    expect(companyEAId).toMatch(/^[0-9a-f-]{36}$/);

    // Segundo usuário não pode rodar bootstrap novamente
    await expect(
      runAsUser(
        USER_OUTSIDER,
        `SELECT public.bootstrap_initial_platform('Empresa Pirata', NULL, 'Invasor');`
      )
    ).rejects.toThrow(/já foi inicializada/);
  });

  it('permite ao platform_admin criar segunda empresa e vincular gestores de cada empresa', async () => {
    const createdB = await runAsUser<{ id: string }>(
      USER_ADMIN,
      `INSERT INTO public.companies (name, legal_name, slug, sidebar_color, primary_color)
       VALUES ('Metrologia Sul', 'Metrologia Sul Ltda', 'metrologia-sul', '#1E293B', '#0284C7')
       RETURNING id;`
    );
    companyBId = createdB[0].id;

    // Vincula Gestor A na EA Balanças e Gestor B na Metrologia Sul
    await runAsUser(
      USER_ADMIN,
      `INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
       VALUES ($1, $2, 'manager', true), ($3, $4, 'manager', true);`,
      [companyEAId, USER_MGR_A, companyBId, USER_MGR_B]
    );

    // Gestor A enxerga apenas EA Balanças; Gestor B enxerga apenas Metrologia Sul; Outsider enxerga 0
    const companiesForA = await runAsUser<{ id: string; name: string }>(
      USER_MGR_A,
      'SELECT id, name FROM public.companies;'
    );
    expect(companiesForA).toHaveLength(1);
    expect(companiesForA[0].id).toBe(companyEAId);

    const companiesForB = await runAsUser<{ id: string; name: string }>(
      USER_MGR_B,
      'SELECT id, name FROM public.companies;'
    );
    expect(companiesForB).toHaveLength(1);
    expect(companiesForB[0].id).toBe(companyBId);

    const companiesForOutsider = await runAsUser(
      USER_OUTSIDER,
      'SELECT id FROM public.companies;'
    );
    expect(companiesForOutsider).toHaveLength(0);
  });

  it('isola rigorosamente cadastros entre empresas (sem acesso cruzado)', async () => {
    // Gestor A cria cliente, unidade, balança e dois técnicos na EA Balanças
    const cA = await runAsUser<{ id: string }>(
      USER_MGR_A,
      `INSERT INTO public.clients (company_id, name, trade_name, document_type, document_number, phone)
       VALUES ($1, 'Frigorífico Paulista S/A', 'FrigoPaulista', 'CNPJ', '45.111.222/0001-33', '(11) 4002-8922')
       RETURNING id;`,
      [companyEAId]
    );
    clientEAId = cA[0].id;

    const uA = await runAsUser<{ id: string }>(
      USER_MGR_A,
      `INSERT INTO public.client_units (company_id, client_id, unit_name, street, street_number, city, state, is_primary)
       VALUES ($1, $2, 'Planta Industrial Barueri', 'Av. Piramboia', '1200', 'Barueri', 'SP', true)
       RETURNING id;`,
      [companyEAId, clientEAId]
    );
    unitEAId = uA[0].id;

    const eqA = await runAsUser<{ id: string }>(
      USER_MGR_A,
      `INSERT INTO public.equipments (company_id, client_id, unit_id, brand, model, serial_number, capacity_label, division_label, accuracy_class)
       VALUES ($1, $2, $3, 'Toledo Prix', '9091', 'SN-EA-9091001', '1500 kg', '200 g', 'III')
       RETURNING id;`,
      [companyEAId, clientEAId, unitEAId]
    );
    equipEAId = eqA[0].id;

    // Gestor B cria cliente na Empresa B
    const cB = await runAsUser<{ id: string }>(
      USER_MGR_B,
      `INSERT INTO public.clients (company_id, name, document_type, document_number)
       VALUES ($1, 'Cerealista Gaúcha Ltda', 'CNPJ', '88.777.666/0001-55')
       RETURNING id;`,
      [companyBId]
    );
    clientBId = cB[0].id;

    // Gestor B NÃO vê clientes, unidades ou equipamentos da EA Balanças
    const bReadingAClients = await runAsUser(
      USER_MGR_B,
      'SELECT * FROM public.clients WHERE company_id = $1;',
      [companyEAId]
    );
    expect(bReadingAClients).toHaveLength(0);

    // Gestor B NÃO consegue inserir equipamento na EA Balanças (bloqueado por RLS)
    await expect(
      runAsUser(
        USER_MGR_B,
        `INSERT INTO public.equipments (company_id, client_id, brand, model, serial_number)
         VALUES ($1, $2, 'Urano', 'Pop-Z', 'HACK-001');`,
        [companyEAId, clientEAId]
      )
    ).rejects.toThrow();

    // Mesmo na própria empresa B, constraint composta impede referenciar client_id da empresa A!
    await expect(
      runAsUser(
        USER_MGR_B,
        `INSERT INTO public.equipments (company_id, client_id, brand, model, serial_number)
         VALUES ($1, $2, 'Urano', 'Pop-Z', 'CROSS-FK-001');`,
        [companyBId, clientEAId]
      )
    ).rejects.toThrow();
    expect(clientBId).toBeTruthy();
  });

  it('restringe técnicos apenas às OS atribuídas a eles, salvo autorização explícita', async () => {
    // Gestor A cadastra Técnico 1 e Técnico 2 vinculados aos usuários e membresia 'technician'
    const t1 = await runAsUser<{ id: string }>(
      USER_MGR_A,
      `INSERT INTO public.technicians (company_id, user_id, full_name, email, specialties, can_view_all_company_os)
       VALUES ($1, $2, 'Carlos Técnico', 'carlos.tec@eabalancas.com.br', ARRAY['Rodoviária', 'Plataforma'], false)
       RETURNING id;`,
      [companyEAId, USER_TECH_A1]
    );
    techA1Id = t1[0].id;

    const t2 = await runAsUser<{ id: string }>(
      USER_MGR_A,
      `INSERT INTO public.technicians (company_id, user_id, full_name, email, specialties, can_view_all_company_os)
       VALUES ($1, $2, 'Marcos Técnico', 'marcos.tec@eabalancas.com.br', ARRAY['Analítica'], false)
       RETURNING id;`,
      [companyEAId, USER_TECH_A2]
    );
    techA2Id = t2[0].id;

    await runAsUser(
      USER_MGR_A,
      `INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
       VALUES ($1, $2, 'technician', true), ($1, $3, 'technician', true);`,
      [companyEAId, USER_TECH_A1, USER_TECH_A2]
    );

    // Gestor A cria OS #1 atribuída ao Técnico 1 e OS #2 atribuída ao Técnico 2
    const os1 = await runAsUser<{ id: string; order_number: string; status: string }>(
      USER_MGR_A,
      `INSERT INTO public.service_orders (
         company_id, client_id, unit_id, equipment_id, primary_technician_id,
         order_type, priority, title, reported_issue, scheduled_start
       ) VALUES (
         $1, $2, $3, $4, $5,
         'calibration', 'high', 'Calibração periódica balança doca', 'Vencimento semestral RBC', now() + interval '1 day'
       ) RETURNING id, order_number, status;`,
      [companyEAId, clientEAId, unitEAId, equipEAId, techA1Id]
    );
    os1Id = os1[0].id;
    expect(os1[0].order_number).toMatch(/^OS-\d{4}-0001$/);
    expect(os1[0].status).toBe('scheduled'); // promovida automaticamente por ter scheduled_start

    const os2 = await runAsUser<{ id: string; order_number: string }>(
      USER_MGR_A,
      `INSERT INTO public.service_orders (
         company_id, client_id, unit_id, equipment_id, primary_technician_id,
         order_type, priority, title, reported_issue
       ) VALUES (
         $1, $2, $3, $4, $5,
         'corrective', 'urgent', 'Célula de carga oscilando', 'Indicação instável no terminal'
       ) RETURNING id, order_number;`,
      [companyEAId, clientEAId, unitEAId, equipEAId, techA2Id]
    );
    os2Id = os2[0].id;
    expect(os2[0].order_number).toMatch(/^OS-\d{4}-0002$/);

    // Gestor A vê ambas as OS (2)
    const managerOrders = await runAsUser<{ id: string }>(
      USER_MGR_A,
      'SELECT id FROM public.service_orders ORDER BY sequence_number;'
    );
    expect(managerOrders).toHaveLength(2);

    // Técnico 1 vê APENAS a OS #1! Não vê a OS #2 de Marcos!
    const tech1Orders = await runAsUser<{ id: string }>(
      USER_TECH_A1,
      'SELECT id FROM public.service_orders;'
    );
    expect(tech1Orders).toHaveLength(1);
    expect(tech1Orders[0].id).toBe(os1Id);

    // Técnico 2 vê APENAS a OS #2! Não vê a OS #1 de Carlos!
    const tech2Orders = await runAsUser<{ id: string }>(
      USER_TECH_A2,
      'SELECT id FROM public.service_orders;'
    );
    expect(tech2Orders).toHaveLength(1);
    expect(tech2Orders[0].id).toBe(os2Id);

    // Técnico 1 NÃO pode criar nova OS nem excluir OS nem alterar configurações da empresa
    await expect(
      runAsUser(
        USER_TECH_A1,
        `INSERT INTO public.service_orders (company_id, client_id, title, reported_issue)
         VALUES ($1, $2, 'Tentativa indevida', 'Sem permissão');`,
        [companyEAId, clientEAId]
      )
    ).rejects.toThrow();

    // Testa Autorização Explícita por OS (allow_company_technicians_view = true)
    await runAsUser(
      USER_MGR_A,
      `UPDATE public.service_orders SET allow_company_technicians_view = true WHERE id = $1;`,
      [os2Id]
    );

    const tech1OrdersAfterExplicitOSFlag = await runAsUser<{ id: string }>(
      USER_TECH_A1,
      'SELECT id FROM public.service_orders ORDER BY sequence_number;'
    );
    expect(tech1OrdersAfterExplicitOSFlag).toHaveLength(2);

    // Reverte flag da OS #2 e testa Autorização Explícita no perfil do Técnico (can_view_all_company_os)
    await runAsUser(
      USER_MGR_A,
      `UPDATE public.service_orders SET allow_company_technicians_view = false WHERE id = $1;`,
      [os2Id]
    );
    const tech1BackToOne = await runAsUser<{ id: string }>(
      USER_TECH_A1,
      'SELECT id FROM public.service_orders;'
    );
    expect(tech1BackToOne).toHaveLength(1);

    await runAsUser(
      USER_MGR_A,
      `UPDATE public.technicians SET can_view_all_company_os = true WHERE id = $1;`,
      [techA1Id]
    );
    const tech1WithProfileOverride = await runAsUser<{ id: string }>(
      USER_TECH_A1,
      'SELECT id FROM public.service_orders;'
    );
    expect(tech1WithProfileOverride).toHaveLength(2);

    // Mesmo com can_view_all_company_os = true na EA Balanças, Técnico 1 JAMAIS vê registros da Empresa B!
    const tech1TryingCompanyB = await runAsUser(
      USER_TECH_A1,
      'SELECT * FROM public.clients WHERE company_id = $1;',
      [companyBId]
    );
    expect(tech1TryingCompanyB).toHaveLength(0);

    // Reverte o override do perfil do técnico para manter isolamento estrito nos testes seguintes
    await runAsUser(
      USER_MGR_A,
      `UPDATE public.technicians SET can_view_all_company_os = false WHERE id = $1;`,
      [techA1Id]
    );
  });

  it('registra histórico automático de alterações (auditoria) na OS', async () => {
    const history = await runAsUser<{ event_type: string; description: string }>(
      USER_MGR_A,
      `SELECT event_type, description
         FROM public.service_order_history
        WHERE service_order_id = $1
        ORDER BY created_at ASC;`,
      [os1Id]
    );
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.map((h) => h.event_type)).toContain('created');
    expect(history.map((h) => h.event_type)).toContain('technician_assigned');
  });

  it('protege buckets do Supabase Storage por tenant e por OS atribuída', async () => {
    // Gestor A pode gravar logo na pasta da própria empresa
    const logoInsert = await runAsUser<{ id: string }>(
      USER_MGR_A,
      `INSERT INTO storage.objects (bucket_id, name)
       VALUES ('company-assets', $1)
       RETURNING id;`,
      [`${companyEAId}/logo.png`]
    );
    expect(logoInsert).toHaveLength(1);

    // Gestor A NÃO pode gravar logo na pasta da Empresa B
    await expect(
      runAsUser(
        USER_MGR_A,
        `INSERT INTO storage.objects (bucket_id, name)
         VALUES ('company-assets', $1);`,
        [`${companyBId}/logo-hack.png`]
      )
    ).rejects.toThrow();

    // Técnico 1 NÃO pode gravar logotipo da empresa
    await expect(
      runAsUser(
        USER_TECH_A1,
        `INSERT INTO storage.objects (bucket_id, name)
         VALUES ('company-assets', $1);`,
        [`${companyEAId}/logo-tec.png`]
      )
    ).rejects.toThrow();

    // Técnico 1 pode enviar anexo para OS #1 (atribuída a ele), mas NÃO para OS #2 (de outro técnico)
    const os1Photo = await runAsUser<{ id: string }>(
      USER_TECH_A1,
      `INSERT INTO storage.objects (bucket_id, name)
       VALUES ('os-attachments', $1)
       RETURNING id;`,
      [`${companyEAId}/${os1Id}/foto-lacre.jpg`]
    );
    expect(os1Photo).toHaveLength(1);

    await expect(
      runAsUser(
        USER_TECH_A1,
        `INSERT INTO storage.objects (bucket_id, name)
         VALUES ('os-attachments', $1);`,
        [`${companyEAId}/${os2Id}/foto-indevida.jpg`]
      )
    ).rejects.toThrow();
  });

  it('protege tabelas preparadas para execução, anexos e assinaturas por RLS', async () => {
    // Técnico 1 registra execução na OS #1 (permitido)
    const exec1 = await runAsUser<{ id: string }>(
      USER_TECH_A1,
      `INSERT INTO public.service_order_executions (
         company_id, service_order_id, technician_id, diagnosis
       ) VALUES ($1, $2, $3, 'Ajuste de linearidade realizado')
       RETURNING id;`,
      [companyEAId, os1Id, techA1Id]
    );
    expect(exec1).toHaveLength(1);

    // Técnico 1 NÃO pode registrar execução na OS #2 (atribuída ao Técnico 2)
    await expect(
      runAsUser(
        USER_TECH_A1,
        `INSERT INTO public.service_order_executions (
           company_id, service_order_id, technician_id, diagnosis
         ) VALUES ($1, $2, $3, 'Tentativa em OS alheia');`,
        [companyEAId, os2Id, techA1Id]
      )
    ).rejects.toThrow();
  });

  it('vincula automaticamente convites por e-mail ao cadastrar usuário no Supabase Auth', async () => {
    const NEW_TECH_USER = '77777777-7777-4777-8777-777777777777';

    // Gestor A cadastra técnico + convite por e-mail antes do usuário criar conta
    const newTech = await runAsUser<{ id: string }>(
      USER_MGR_A,
      `INSERT INTO public.technicians (company_id, full_name, email)
       VALUES ($1, 'Renata Metrologista', 'renata@eabalancas.com.br')
       RETURNING id;`,
      [companyEAId]
    );

    await runAsUser(
      USER_MGR_A,
      `INSERT INTO public.company_invitations (company_id, email, full_name, role, technician_id)
       VALUES ($1, 'renata@eabalancas.com.br', 'Renata Metrologista', 'technician', $2);`,
      [companyEAId, newTech[0].id]
    );

    // Simula Sign Up no Supabase Auth
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${NEW_TECH_USER}', 'renata@eabalancas.com.br', '{"full_name": "Renata Metrologista"}');
    `);

    const memberships = await runAsUser<{ company_id: string; role: string }>(
      NEW_TECH_USER,
      `SELECT company_id, role FROM public.company_memberships WHERE user_id = $1;`,
      [NEW_TECH_USER]
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0].company_id).toBe(companyEAId);
    expect(memberships[0].role).toBe('technician');
  });
});
