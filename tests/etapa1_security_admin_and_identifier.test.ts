import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ETAPA 1 — 4º Perfil (Administrator), Isolamento Super Admin, e Autenticação por Identificador', () => {
  let db: PGlite;

  const USER_PLATFORM_ADMIN = '00000000-0000-4000-8000-000000000000';
  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_TECNICO_A = '33333333-3333-4333-8333-333333333333';
  const USER_GESTOR_B = '22222222-2222-4222-8222-222222222222';
  const USER_ATTACKER = '99999999-9999-4999-8999-999999999999';

  let companyAId = '';
  let companyBId = '';

  async function runAsUser<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    await db.exec('BEGIN');
    try {
      if (userId) {
        await db.exec(`SET LOCAL ROLE authenticated;`);
        await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', true);`);
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

    // Mock do schema de autenticação do Supabase
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

      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text UNIQUE,
        encrypted_password text DEFAULT 'temp_encrypted_hash_default_123',
        email_confirmed_at timestamptz DEFAULT now(),
        confirmed_at timestamptz DEFAULT now(),
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      CREATE SCHEMA IF NOT EXISTS storage;
      GRANT USAGE ON SCHEMA storage TO anon, authenticated;

      CREATE TABLE IF NOT EXISTS storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );

      CREATE TABLE IF NOT EXISTS storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text,
        name text NOT NULL,
        owner uuid DEFAULT auth.uid(),
        created_at timestamptz DEFAULT now()
      );
    `);

    // Executa migrações base: 001, 003, 004, 005
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/005_technician_invitation_system.sql'), 'utf-8'));

    // Executa a nova migração 008 separada em 008a e 008b (Etapa 1)
    await db.exec(readFileSync(resolve('supabase/migrations/008a_add_administrator_enum.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/008b_administrator_and_employee_auth.sql'), 'utf-8'));

    // Empresa A (EA Balanças)
    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    // Empresa B (Concorrente)
    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, is_active)
      VALUES ('Metrologia Brasil', 'Metrologia Brasil Ltda', 'metrologia-brasil', '99.888.777/0001-66', true)
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    // Inserção de usuários no auth.users
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_PLATFORM_ADMIN}', 'superadmin@metrion.com.br'),
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br'),
        ('${USER_ADMIN_A}', 'carlos.admin.ea-balancas@auth.metrion.internal'),
        ('${USER_TECNICO_A}', 'roberto.campo@eabalancas.com.br'),
        ('${USER_GESTOR_B}', 'gestor@metrobrasil.com.br'),
        ('${USER_ATTACKER}', 'invasor@hacker.com');

      -- Platform Admin registrado
      INSERT INTO public.platform_admins (user_id, is_active, notes)
      VALUES ('${USER_PLATFORM_ADMIN}', true, 'Super Admin Metrion');

      -- Membros Empresa A
      INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', 'gestor.ea', true),
        ('${companyAId}', '${USER_ADMIN_A}', 'administrator', 'carlos.admin', true),
        ('${companyAId}', '${USER_TECNICO_A}', 'technician', 'roberto.tech', true);

      -- Membros Empresa B
      INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active) VALUES
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', 'gestor.b', true);

      -- Perfis
      INSERT INTO public.profiles (id, full_name, email, default_company_id, must_change_password) VALUES
        ('${USER_GESTOR_A}', 'Eduardo Gestor', 'gestor@eabalancas.com.br', '${companyAId}', false),
        ('${USER_ADMIN_A}', 'Carlos Administrador', 'carlos.admin.ea-balancas@auth.metrion.internal', '${companyAId}', true),
        ('${USER_TECNICO_A}', 'Roberto Silva', 'roberto.campo@eabalancas.com.br', '${companyAId}', false),
        ('${USER_GESTOR_B}', 'Gestor Empresa B', 'gestor@metrobrasil.com.br', '${companyBId}', false)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        default_company_id = EXCLUDED.default_company_id,
        must_change_password = EXCLUDED.must_change_password;

      -- Técnico Empresa A
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyAId}', '${USER_TECNICO_A}', 'Roberto Silva', 'roberto.campo@eabalancas.com.br', true);
    `);
  });

  it('1. Perfil "administrator" é aceito no enum app_role e integrado ao banco', async () => {
    const res = await db.query<{ enumlabel: string }>(`
      SELECT enumlabel FROM pg_enum
       WHERE enumtypid = 'public.app_role'::regtype
       ORDER BY enumlabel;
    `);
    const labels = res.rows.map((r) => r.enumlabel);
    expect(labels).toContain('manager');
    expect(labels).toContain('administrator');
    expect(labels).toContain('technician');
  });

  it('2. Gestor gerencia membros; Administrador NÃO PODE criar outros administradores nem elevar privilégios', async () => {
    // Gestor A cria um novo membro na Empresa A
    const NEW_USER_ID = '77777777-7777-4777-8777-777777777777';
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${NEW_USER_ID}', 'novo@empresa.com')`);

    const created = await runAsUser(
      USER_GESTOR_A,
      `INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active)
       VALUES ('${companyAId}', '${NEW_USER_ID}', 'technician', 'novo.tech', true)
       RETURNING id;`
    );
    expect(created.length).toBe(1);

    // Administrador Operacional tenta criar outro membro na Empresa A -> DEVE SER BLOQUEADO POR RLS
    const ATTACK_USER_ID = '88888888-8888-4888-8888-888888888888';
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ATTACK_USER_ID}', 'admin.fake@empresa.com')`);

    await expect(
      runAsUser(
        USER_ADMIN_A,
        `INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active)
         VALUES ('${companyAId}', '${ATTACK_USER_ID}', 'manager', 'invasor.privilegio', true);`
      )
    ).rejects.toThrow();
  });

  it('3. Isolamento multiempresa: Gestor da Empresa B NÃO acessa nem modifica membros da Empresa A', async () => {
    const membersOfAFromB = await runAsUser(
      USER_GESTOR_B,
      `SELECT * FROM public.company_memberships WHERE company_id = '${companyAId}';`
    );
    // RLS deve retornar zero registros de outra empresa
    expect(membersOfAFromB.length).toBe(0);

    // Tentativa de update malicioso
    await runAsUser(
      USER_GESTOR_B,
      `UPDATE public.company_memberships SET is_active = false WHERE company_id = '${companyAId}';`
    );

    // Confirma que nenhum registro de A foi afetado
    const checkA = await db.query<{ count: string }>(
      `SELECT count(*) FROM public.company_memberships WHERE company_id = '${companyAId}' AND is_active = true;`
    );
    expect(parseInt(checkA.rows[0].count, 10)).toBeGreaterThan(0);
  });

  it('4. Super Admin Metrion NÃO tem acesso automático a dados operacionais sem sessão de suporte ativa', async () => {
    // Insere cliente na Empresa B
    await runAsUser(
      USER_GESTOR_B,
      `INSERT INTO public.clients (company_id, name, document_type, document_number)
       VALUES ('${companyBId}', 'Cliente Confidencial da Empresa B', 'CNPJ', '11.222.333/0001-44');`
    );

    // Super Admin tenta ler clientes da Empresa B (onde não tem membership)
    const clientsViewedBySuperAdmin = await runAsUser(
      USER_PLATFORM_ADMIN,
      `SELECT * FROM public.clients WHERE company_id = '${companyBId}';`
    );
    // Deve retornar ZERO linhas: acesso direto sem chamado/suporte está bloqueado!
    expect(clientsViewedBySuperAdmin.length).toBe(0);
  });

  it('5. Super Admin com sessão de suporte válida e auditada CONSEGUE acessar durante a janela', async () => {
    // Registra sessão de suporte com justificativa auditada válida por 2 horas
    await db.exec(`
      INSERT INTO public.platform_support_sessions (platform_admin_id, company_id, reason, expires_at)
      VALUES ('${USER_PLATFORM_ADMIN}', '${companyBId}', 'Atendimento de chamado #1042 aberto pelo cliente', now() + interval '2 hours');
    `);

    // Agora o Super Admin consegue auditar dados operacionais da Empresa B
    const clientsDuringSupport = await runAsUser(
      USER_PLATFORM_ADMIN,
      `SELECT * FROM public.clients WHERE company_id = '${companyBId}';`
    );
    expect(clientsDuringSupport.length).toBe(1);
    expect((clientsDuringSupport[0] as any).name).toBe('Cliente Confidencial da Empresa B');

    // Revoga a sessão de suporte
    await db.exec(`
      UPDATE public.platform_support_sessions
         SET revoked_at = now()
       WHERE platform_admin_id = '${USER_PLATFORM_ADMIN}' AND company_id = '${companyBId}';
    `);

    // Após revogação, o acesso cessa instantaneamente
    const clientsAfterRevoke = await runAsUser(
      USER_PLATFORM_ADMIN,
      `SELECT * FROM public.clients WHERE company_id = '${companyBId}';`
    );
    expect(clientsAfterRevoke.length).toBe(0);
  });

  it('6. Unicidade de username dentro da mesma empresa e independência entre empresas diferentes', async () => {
    // Permite mesmo username em empresas diferentes (ex.: 'carlos.silva' na Empresa A e Empresa B)
    const USER_CARLOS_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${USER_CARLOS_B}', 'carlos.b@empresa.com')`);

    const insertB = await runAsUser(
      USER_GESTOR_B,
      `INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active)
       VALUES ('${companyBId}', '${USER_CARLOS_B}', 'administrator', 'carlos.admin', true)
       RETURNING id;`
    );
    expect(insertB.length).toBe(1);

    // Mas proíbe duplicidade do mesmo username na Empresa A (violação da constraint UNIQUE)
    const USER_DUPLICATE_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${USER_DUPLICATE_A}', 'duplicado@empresa.com')`);

    await expect(
      runAsUser(
        USER_GESTOR_A,
        `INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active)
         VALUES ('${companyAId}', '${USER_DUPLICATE_A}', 'technician', 'carlos.admin', true);`
      )
    ).rejects.toThrow();
  });

  it('7. Função resolve_employee_identifier resolve usuário ativo e previne enumeração em erros', async () => {
    // 1. Resolução bem-sucedida para colaborador ativo
    const resValid = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', 'carlos.admin');`
    );
    const dataValid = resValid.rows[0].resolve_employee_identifier;
    expect(dataValid.found).toBe(true);
    expect(dataValid.is_active).toBe(true);
    expect(dataValid.email).toBe('carlos.admin.ea-balancas@auth.metrion.internal');
    expect(dataValid.must_change_password).toBe(true);

    // 2. Empresa inexistente -> Retorna found: false sem expor detalhes
    const resNoCompany = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('empresa-inexistente-xyz', 'carlos.admin');`
    );
    expect(resNoCompany.rows[0].resolve_employee_identifier.found).toBe(false);

    // 3. Usuário inexistente na empresa -> Retorna found: false (mesma resposta para evitar enumeração)
    const resNoUser = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', 'usuario-inexistente-123');`
    );
    expect(resNoUser.rows[0].resolve_employee_identifier.found).toBe(false);

    // 4. Usuário bloqueado pela administração
    await db.exec(`
      UPDATE public.company_memberships
         SET is_active = false
       WHERE company_id = '${companyAId}' AND username = 'carlos.admin';
    `);

    const resBlocked = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', 'carlos.admin');`
    );
    const dataBlocked = resBlocked.rows[0].resolve_employee_identifier;
    expect(dataBlocked.found).toBe(true);
    expect(dataBlocked.is_active).toBe(false);
    expect(dataBlocked.error).toContain('desativada pela administração');

    // 5. Reativação da conta
    await db.exec(`
      UPDATE public.company_memberships
         SET is_active = true
       WHERE company_id = '${companyAId}' AND username = 'carlos.admin';
    `);

    const resReactivated = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', 'carlos.admin');`
    );
    expect(resReactivated.rows[0].resolve_employee_identifier.is_active).toBe(true);
  });

  it('8. Permissões operacionais do Administrador: cria/atualiza clientes e OS, mas não pode alterar configurações fiscais da empresa', async () => {
    // 8.1 Enquanto must_change_password for true, RLS bloqueia operações no banco
    await expect(
      runAsUser(
        USER_ADMIN_A,
        `INSERT INTO public.clients (company_id, name, document_type, document_number)
         VALUES ('${companyAId}', 'Cliente Tentativa Bloqueada', 'CNPJ', '22.333.444/0001-55');`
      )
    ).rejects.toThrow();

    // 8.2 Usuário tenta burlar desmarcando a flag diretamente via UPDATE no profiles -> RLS bloqueia
    await expect(
      runAsUser(
        USER_ADMIN_A,
        `UPDATE public.profiles SET must_change_password = false WHERE id = '${USER_ADMIN_A}';`
      )
    ).rejects.toThrow();

    // 8.3 Usuário tenta chamar confirm_password_changed() sem trocar a senha -> REJEITADO
    await expect(
      runAsUser(USER_ADMIN_A, `SELECT public.confirm_password_changed();`)
    ).rejects.toThrow(/A troca de senha não foi detectada/);

    // 8.4 Atacante atualiza metadados ou updated_at no auth.users e tenta confirmar -> REJEITADO
    await db.exec(`
      UPDATE auth.users
         SET raw_user_meta_data = '{"spoofed": true}'::jsonb,
             updated_at = now()
       WHERE id = '${USER_ADMIN_A}';
    `);
    await expect(
      runAsUser(USER_ADMIN_A, `SELECT public.confirm_password_changed();`)
    ).rejects.toThrow(/A troca de senha não foi detectada/);

    // 8.5 Troca real de senha no Supabase Auth: o hash da senha criptografada muda
    await db.exec(`
      UPDATE auth.users
         SET encrypted_password = 'new_personal_bcrypt_hash_987654',
             updated_at = now()
       WHERE id = '${USER_ADMIN_A}';
    `);

    // Agora sim: a RPC segura confirma a troca com comprovação matemática do hash
    const confirmRes = await runAsUser<{ confirm_password_changed: boolean }>(
      USER_ADMIN_A,
      `SELECT public.confirm_password_changed();`
    );
    expect(confirmRes[0].confirm_password_changed).toBe(true);

    // 8.6 Agora liberado: Administrador cria cliente com sucesso na Empresa A
    const clientCreated = await runAsUser(
      USER_ADMIN_A,
      `INSERT INTO public.clients (company_id, name, document_type, document_number)
       VALUES ('${companyAId}', 'Cliente Criado pelo Administrador', 'CNPJ', '22.333.444/0001-55')
       RETURNING id;`
    );
    expect(clientCreated.length).toBe(1);

    // Administrador cria Ordem de Serviço com sucesso na Empresa A
    const osCreated = await runAsUser(
      USER_ADMIN_A,
      `INSERT INTO public.service_orders (company_id, client_id, title, reported_issue, status, priority, order_type)
       VALUES ('${companyAId}', '${(clientCreated[0] as any).id}', 'Calibração em Balança Rodoviária', 'Verificação periódica preventiva', 'open', 'medium', 'corrective')
       RETURNING id;`
    );
    expect(osCreated.length).toBe(1);

    // Administrador tenta alterar razão social ou CNPJ da empresa -> BLOQUEADO POR RLS
    // (apenas gestor pode atualizar dados da empresa em companies_update_policy)
    const updateComp = await runAsUser(
      USER_ADMIN_A,
      `UPDATE public.companies SET legal_name = 'Nome Ilegal Hackeado' WHERE id = '${companyAId}' RETURNING id;`
    );
    // RLS deve retornar zero linhas atualizadas
    expect(updateComp.length).toBe(0);

    const checkComp = await db.query<{ legal_name: string }>(
      `SELECT legal_name FROM public.companies WHERE id = '${companyAId}';`
    );
    expect(checkComp.rows[0].legal_name).not.toBe('Nome Ilegal Hackeado');
  });

  it('9. Técnico tem permissões estritas: bloqueado de criar clientes ou ordens de serviço', async () => {
    // Técnico tenta criar cliente -> RLS bloqueia
    await expect(
      runAsUser(
        USER_TECNICO_A,
        `INSERT INTO public.clients (company_id, name, document_type, document_number)
         VALUES ('${companyAId}', 'Cliente Ilegal por Tecnico', 'CNPJ', '33.444.555/0001-66');`
      )
    ).rejects.toThrow();

    // Técnico tenta criar ordem de serviço -> RLS bloqueia
    await expect(
      runAsUser(
        USER_TECNICO_A,
        `INSERT INTO public.service_orders (company_id, status, priority, order_type)
         VALUES ('${companyAId}', 'open', 'medium', 'corrective');`
      )
    ).rejects.toThrow();
  });
});
