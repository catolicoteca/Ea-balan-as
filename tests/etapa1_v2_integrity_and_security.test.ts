import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ETAPA 1 V2 — Integridade Estrita de Balanças por OS e Segurança de Autenticação no Servidor', () => {
  let db: PGlite;

  const USER_PLATFORM_ADMIN = '00000000-0000-4000-8000-000000000000';
  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_TECNICO_A = '33333333-3333-4333-8333-333333333333';
  const USER_GESTOR_B = '22222222-2222-4222-8222-222222222222';
  const USER_TECNICO_B = '44444444-4444-4444-8444-444444444444';

  let companyAId = '';
  let companyBId = '';

  let clientA1Id = ''; // Frigorífico Estrela (Empresa A)
  let clientA2Id = ''; // Supermercado Alvorada (Empresa A)
  let clientB1Id = ''; // Usina do Sul (Empresa B)

  let eqA1_BalancaRodoviaria = ''; // Balança do Frigorífico Estrela (Empresa A)
  let eqA1_BalancaPlataforma = '';  // 2ª Balança do Frigorífico Estrela (Empresa A)
  let eqA2_BalancaCheckout = '';    // Balança do Supermercado Alvorada (Empresa A)
  let eqB1_BalancaPesada = '';      // Balança da Usina do Sul (Empresa B)

  let osClientA1 = ''; // OS aberta para o Frigorífico Estrela (Empresa A)
  let osClientB1 = ''; // OS aberta para a Usina do Sul (Empresa B)

  const TICKET_ADMIN_A = '99999999-9999-4999-8999-999999999999';

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

    // 1. Mock do schema de autenticação do Supabase
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

    // 2. Executa as migrações na ordem exata de dependências
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/005_technician_invitation_system.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/008a_add_administrator_enum.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/008b_administrator_and_employee_auth.sql'), 'utf-8'));

    // 3. Executa a Migração 009 atualizada
    await db.exec(readFileSync(resolve('supabase/migrations/009_metrology_ordinance_and_multi_equipment_os.sql'), 'utf-8'));

    // 4. Configuração dos dados de teste
    // Empresa A
    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    // Empresa B (Concorrente)
    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, is_active)
      VALUES ('Metrologia Brasil', 'Metrologia Brasil Ltda', 'metrologia-brasil', '99.888.777/0001-66', true)
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    // Inserção de usuários no auth.users (SEM acessar encrypted_password)
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_PLATFORM_ADMIN}', 'superadmin@metrion.com.br'),
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br'),
        ('${USER_ADMIN_A}', 'carlos.admin.ea-balancas@auth.metrion.internal'),
        ('${USER_TECNICO_A}', 'roberto.campo@eabalancas.com.br'),
        ('${USER_GESTOR_B}', 'gestor@metrobrasil.com.br'),
        ('${USER_TECNICO_B}', 'marcos.campo@metrobrasil.com.br');

      -- Membros Empresa A
      INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', 'gestor.ea', true),
        ('${companyAId}', '${USER_ADMIN_A}', 'administrator', 'carlos.admin', true),
        ('${companyAId}', '${USER_TECNICO_A}', 'technician', 'roberto.tech', true);

      -- Membros Empresa B
      INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active) VALUES
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', 'gestor.b', true),
        ('${companyBId}', '${USER_TECNICO_B}', 'technician', 'marcos.tech', true);

      -- Perfis
      INSERT INTO public.profiles (id, full_name, email, default_company_id, must_change_password, password_change_ticket) VALUES
        ('${USER_GESTOR_A}', 'Eduardo Gestor', 'gestor@eabalancas.com.br', '${companyAId}', false, NULL),
        ('${USER_ADMIN_A}', 'Carlos Administrador', 'carlos.admin.ea-balancas@auth.metrion.internal', '${companyAId}', true, '${TICKET_ADMIN_A}'),
        ('${USER_TECNICO_A}', 'Roberto Silva', 'roberto.campo@eabalancas.com.br', '${companyAId}', false, NULL),
        ('${USER_GESTOR_B}', 'Gestor Empresa B', 'gestor@metrobrasil.com.br', '${companyBId}', false, NULL),
        ('${USER_TECNICO_B}', 'Marcos Técnico B', 'marcos.campo@metrobrasil.com.br', '${companyBId}', false, NULL)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        default_company_id = EXCLUDED.default_company_id,
        must_change_password = EXCLUDED.must_change_password,
        password_change_ticket = EXCLUDED.password_change_ticket;

      -- Técnicos
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active) VALUES
        ('${companyAId}', '${USER_TECNICO_A}', 'Roberto Silva', 'roberto.campo@eabalancas.com.br', true),
        ('${companyBId}', '${USER_TECNICO_B}', 'Marcos Silva', 'marcos.campo@metrobrasil.com.br', true);
    `);

    // 5. Clientes e Equipamentos
    // Empresa A - Cliente 1 (Frigorífico Estrela)
    const clA1 = await db.query<{ id: string }>(`
      INSERT INTO public.clients (company_id, name, document_type, document_number)
      VALUES ('${companyAId}', 'Frigorífico Estrela S.A.', 'CNPJ', '11.222.333/0001-44')
      RETURNING id;
    `);
    clientA1Id = clA1.rows[0].id;

    // Empresa A - Cliente 2 (Supermercado Alvorada)
    const clA2 = await db.query<{ id: string }>(`
      INSERT INTO public.clients (company_id, name, document_type, document_number)
      VALUES ('${companyAId}', 'Supermercado Alvorada Ltda', 'CNPJ', '22.333.444/0001-55')
      RETURNING id;
    `);
    clientA2Id = clA2.rows[0].id;

    // Empresa B - Cliente 1 (Usina do Sul)
    const clB1 = await db.query<{ id: string }>(`
      INSERT INTO public.clients (company_id, name, document_type, document_number)
      VALUES ('${companyBId}', 'Usina do Sul S.A.', 'CNPJ', '99.111.222/0001-33')
      RETURNING id;
    `);
    clientB1Id = clB1.rows[0].id;

    // Balanças do Cliente 1 da Empresa A
    const b1 = await db.query<{ id: string }>(`
      INSERT INTO public.equipments (company_id, client_id, equipment_type, brand, model, serial_number, capacity_label, division_label, inmetro_ordinance)
      VALUES ('${companyAId}', '${clientA1Id}', 'Balança Rodoviária', 'Toledo', '720i', 'ROD-88219', '80.000 kg', '10 kg', 'Portaria Inmetro/Dimel nº 012/2018')
      RETURNING id;
    `);
    eqA1_BalancaRodoviaria = b1.rows[0].id;

    const b1b = await db.query<{ id: string }>(`
      INSERT INTO public.equipments (company_id, client_id, equipment_type, brand, model, serial_number, capacity_label, division_label, inmetro_ordinance)
      VALUES ('${companyAId}', '${clientA1Id}', 'Balança de Plataforma', 'Toledo', '2090', 'REC-11029', '1.500 kg', '500 g', 'Portaria Inmetro/Dimel nº 236/1994')
      RETURNING id;
    `);
    eqA1_BalancaPlataforma = b1b.rows[0].id;

    // Balança do Cliente 2 da Empresa A
    const b2 = await db.query<{ id: string }>(`
      INSERT INTO public.equipments (company_id, client_id, equipment_type, brand, model, serial_number, capacity_label, division_label, inmetro_ordinance)
      VALUES ('${companyAId}', '${clientA2Id}', 'Balança Checkout', 'Filizola', 'CS15', 'CHK-99412', '15 kg', '5 g', 'Portaria Inmetro/Dimel nº 088/2003')
      RETURNING id;
    `);
    eqA2_BalancaCheckout = b2.rows[0].id;

    // Balança do Cliente 1 da Empresa B
    const bB = await db.query<{ id: string }>(`
      INSERT INTO public.equipments (company_id, client_id, equipment_type, brand, model, serial_number, capacity_label, division_label, inmetro_ordinance)
      VALUES ('${companyBId}', '${clientB1Id}', 'Balança de Fluxo', 'Saturno', '120', 'USI-55441', '120.000 kg', '20 kg', 'Portaria Inmetro/Dimel nº 155/2015')
      RETURNING id;
    `);
    eqB1_BalancaPesada = bB.rows[0].id;

    // Ordem de Serviço da Empresa A para o Cliente 1 (Frigorífico Estrela)
    const osA = await db.query<{ id: string }>(`
      INSERT INTO public.service_orders (company_id, client_id, title, reported_issue, status, priority, order_type)
      VALUES ('${companyAId}', '${clientA1Id}', 'Calibração Anual Frigorífico Estrela', 'Calibração com pesos padrão rastreados RBC', 'open', 'high', 'preventive')
      RETURNING id;
    `);
    osClientA1 = osA.rows[0].id;

    // Ordem de Serviço da Empresa B para a Usina do Sul
    const osB = await db.query<{ id: string }>(`
      INSERT INTO public.service_orders (company_id, client_id, title, reported_issue, status, priority, order_type)
      VALUES ('${companyBId}', '${clientB1Id}', 'Manutenção Usina do Sul', 'Verificação de células de carga', 'open', 'medium', 'corrective')
      RETURNING id;
    `);
    osClientB1 = osB.rows[0].id;
  });

  // ==========================================================================
  // PARTE 1: INTEGRIDADE ESTRITA NO BANCO (service_order_equipments)
  // ==========================================================================

  it('1.1 Campo formal "inmetro_ordinance" está ativo e gravado na tabela equipments', async () => {
    const res = await db.query<{ inmetro_ordinance: string }>(
      `SELECT inmetro_ordinance FROM public.equipments WHERE id = '${eqA1_BalancaRodoviaria}';`
    );
    expect(res.rows[0].inmetro_ordinance).toBe('Portaria Inmetro/Dimel nº 012/2018');
  });

  it('1.2 Vínculo legítimo de balanças do mesmo cliente e empresa na OS é aceito com sucesso', async () => {
    // Gestor vincula a 1ª balança do Frigorífico Estrela à OS do Frigorífico Estrela
    const link1 = await runAsUser(
      USER_GESTOR_A,
      `INSERT INTO public.service_order_equipments (company_id, service_order_id, equipment_id, is_primary, notes)
       VALUES ('${companyAId}', '${osClientA1}', '${eqA1_BalancaRodoviaria}', true, 'Balança principal rodoviária')
       RETURNING id;`
    );
    expect(link1.length).toBe(1);

    // Gestor vincula a 2ª balança (plataforma) à mesma OS na mesma visita
    const link2 = await runAsUser(
      USER_GESTOR_A,
      `INSERT INTO public.service_order_equipments (company_id, service_order_id, equipment_id, is_primary, notes)
       VALUES ('${companyAId}', '${osClientA1}', '${eqA1_BalancaPlataforma}', false, 'Balança adicional do setor de recepção')
       RETURNING id;`
    );
    expect(link2.length).toBe(1);
  });

  it('1.3 BANCO REJEITA tentativa Cross-Tenant: vincular balança da Empresa B a uma OS da Empresa A', async () => {
    // Atacante ou erro de payload tenta associar a balança da Usina (Empresa B) à OS do Frigorífico (Empresa A)
    await expect(
      runAsUser(
        USER_GESTOR_A,
        `INSERT INTO public.service_order_equipments (company_id, service_order_id, equipment_id, is_primary)
         VALUES ('${companyAId}', '${osClientA1}', '${eqB1_BalancaPesada}', false);`
      )
    ).rejects.toThrow(/Inconsistência multiempresa/);
  });

  it('1.4 BANCO REJEITA tentativa Cross-Tenant via company_id falso ou adulterado', async () => {
    // Tenta gravar vínculo informando company_id da Empresa B para uma OS da Empresa A
    await expect(
      db.query(
        `INSERT INTO public.service_order_equipments (company_id, service_order_id, equipment_id, is_primary)
         VALUES ('${companyBId}', '${osClientA1}', '${eqA1_BalancaRodoviaria}', false);`
      )
    ).rejects.toThrow(/Inconsistência multiempresa/);
  });

  it('1.5 BANCO REJEITA tentativa Cross-Client: balança de outro cliente mesmo dentro da mesma empresa', async () => {
    // A Balança de Checkout pertence ao Supermercado Alvorada (Cliente 2 da Empresa A).
    // A OS foi aberta especificamente para o Frigorífico Estrela (Cliente 1 da Empresa A).
    // O motor do banco DEVE impedir a contaminação cadastral entre clientes diferentes!
    await expect(
      runAsUser(
        USER_GESTOR_A,
        `INSERT INTO public.service_order_equipments (company_id, service_order_id, equipment_id, is_primary)
         VALUES ('${companyAId}', '${osClientA1}', '${eqA2_BalancaCheckout}', false);`
      )
    ).rejects.toThrow(/Inconsistência de cliente: a balança pertence ao cliente.*enquanto a Ordem de Serviço foi aberta para o cliente/);
  });

  it('1.6 BANCO REJEITA adulteração via UPDATE em service_order_equipments existente', async () => {
    // Obtém o registro associativo existente
    const links = await db.query<{ id: string }>(
      `SELECT id FROM public.service_order_equipments WHERE service_order_id = '${osClientA1}' AND equipment_id = '${eqA1_BalancaPlataforma}';`
    );
    const targetLinkId = links.rows[0].id;

    // Tenta atualizar o equipment_id para a balança de outro cliente
    await expect(
      runAsUser(
        USER_GESTOR_A,
        `UPDATE public.service_order_equipments
            SET equipment_id = '${eqA2_BalancaCheckout}'
          WHERE id = '${targetLinkId}';`
      )
    ).rejects.toThrow(/Inconsistência de cliente/);

    // Tenta atualizar para a balança de outra empresa
    await expect(
      runAsUser(
        USER_GESTOR_A,
        `UPDATE public.service_order_equipments
            SET equipment_id = '${eqB1_BalancaPesada}'
          WHERE id = '${targetLinkId}';`
      )
    ).rejects.toThrow(/Inconsistência multiempresa/);
  });

  it('1.7 RLS Multi-Tenant: Usuários da Empresa B não visualizam vínculos de balanças da Empresa A', async () => {
    // Empresa B cria vínculo legítimo de balança na sua própria OS
    const linkB = await runAsUser(
      USER_GESTOR_B,
      `INSERT INTO public.service_order_equipments (company_id, service_order_id, equipment_id, is_primary)
       VALUES ('${companyBId}', '${osClientB1}', '${eqB1_BalancaPesada}', true)
       RETURNING id;`
    );
    expect(linkB.length).toBe(1);

    // Gestor da Empresa B tenta visualizar vínculos da Empresa A -> RETORNA ZERO
    const linksVisibleToCompanyB = await runAsUser(
      USER_GESTOR_B,
      `SELECT * FROM public.service_order_equipments WHERE company_id = '${companyAId}';`
    );
    expect(linksVisibleToCompanyB.length).toBe(0);
  });

  // ==========================================================================
  // PARTE 2: RATE LIMITING E PROTEÇÃO CONTRA FORÇA BRUTA NO SERVIDOR
  // ==========================================================================

  it('2.1 Resolução de identificador válido e registro de falhas sucessivas no servidor', async () => {
    // 1. Consulta inicial: usuário válido e desbloqueado
    const resInitial = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', 'carlos.admin');`
    );
    expect(resInitial.rows[0].resolve_employee_identifier.found).toBe(true);
    expect(resInitial.rows[0].resolve_employee_identifier.locked).toBeUndefined();

    // 2. Simulação de 4 senhas incorretas consecutivas enviadas contra este colaborador
    for (let i = 1; i <= 4; i++) {
      const failRes = await db.query<{ record_login_failure: any }>(
        `SELECT public.record_login_failure('ea-balancas', 'carlos.admin');`
      );
      const data = failRes.rows[0].record_login_failure;
      expect(data.locked).toBe(false);
      expect(data.failed_attempts).toBe(i);
      expect(data.remaining_attempts).toBe(5 - i);
    }

    // 3. 5ª tentativa incorreta aciona o bloqueio de segurança no servidor
    const fifthFail = await db.query<{ record_login_failure: any }>(
      `SELECT public.record_login_failure('ea-balancas', 'carlos.admin');`
    );
    const fifthData = fifthFail.rows[0].record_login_failure;
    expect(fifthData.locked).toBe(true);
    expect(fifthData.remaining_attempts).toBe(0);
    expect(fifthData.locked_until).toBeDefined();

    // 4. Imediatamente após o bloqueio, qualquer chamada a resolve_employee_identifier
    // é REJEITADA NO SERVIDOR antes de sequer tentar autenticação
    const resBlocked = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', 'carlos.admin');`
    );
    const blockedData = resBlocked.rows[0].resolve_employee_identifier;
    expect(blockedData.found).toBe(false);
    expect(blockedData.locked).toBe(true);
    expect(blockedData.error).toContain('bloqueado por 15 minutos');
  });

  it('2.2 Sucesso na autenticação remove contadores de bloqueio e restaura o acesso', async () => {
    // O colaborador autentica com sucesso (ou o gestor limpa o lockout)
    const successRes = await db.query<{ record_login_success: boolean }>(
      `SELECT public.record_login_success('ea-balancas', 'carlos.admin');`
    );
    expect(successRes.rows[0].record_login_success).toBe(true);

    // O acesso volta a ser resolvido normalmente
    const resRestored = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', 'carlos.admin');`
    );
    expect(resRestored.rows[0].resolve_employee_identifier.found).toBe(true);
    expect(resRestored.rows[0].resolve_employee_identifier.locked).toBeUndefined();
  });

  it('2.3 Ataque de enumeração por dicionário: consultas contínuas a usuários inexistentes são bloqueadas', async () => {
    const sweepKey = 'sweep.attacker';

    // 5 consultas maliciosas com usuário inexistente
    for (let i = 1; i <= 5; i++) {
      await db.query(`SELECT public.resolve_employee_identifier('ea-balancas', '${sweepKey}');`);
    }

    // Na 6ª tentativa, o servidor bloqueia o identificador varrido
    const resSwept = await db.query<{ resolve_employee_identifier: any }>(
      `SELECT public.resolve_employee_identifier('ea-balancas', '${sweepKey}');`
    );
    expect(resSwept.rows[0].resolve_employee_identifier.locked).toBe(true);
    expect(resSwept.rows[0].resolve_employee_identifier.found).toBe(false);
  });

  // ==========================================================================
  // PARTE 3: REVISÃO DE TROCA OBRIGATÓRIA DE SENHA SEM auth.users.encrypted_password
  // ==========================================================================

  it('3.1 Colaborador com must_change_password = true fica bloqueado de operações no banco', async () => {
    // USER_ADMIN_A tem must_change_password = true
    await expect(
      runAsUser(
        USER_ADMIN_A,
        `INSERT INTO public.clients (company_id, name, document_type, document_number)
         VALUES ('${companyAId}', 'Cliente Invasão Bloqueada', 'CNPJ', '33.444.555/0001-66');`
      )
    ).rejects.toThrow();
  });

  it('3.2 Usuário comum é impedido de desmarcar must_change_password via UPDATE direto no profiles', async () => {
    await expect(
      runAsUser(
        USER_ADMIN_A,
        `UPDATE public.profiles SET must_change_password = false WHERE id = '${USER_ADMIN_A}';`
      )
    ).rejects.toThrow();
  });

  it('3.3 Chamada a confirm_password_changed() sem ticket válido é REJEITADA sem ler encrypted_password', async () => {
    // Chamada sem parâmetros
    await expect(
      runAsUser(USER_ADMIN_A, `SELECT public.confirm_password_changed();`)
    ).rejects.toThrow(/exige validação prévia pelo servidor/);

    // Chamada com ticket falso forjado pelo usuário
    await expect(
      runAsUser(USER_ADMIN_A, `SELECT public.confirm_password_changed('00000000-0000-0000-0000-000000000000'::uuid);`)
    ).rejects.toThrow(/exige validação prévia pelo servidor/);
  });

  it('3.4 Confirmação autoritativa do servidor libera o colaborador sem qualquer dependência de encrypted_password', async () => {
    // O servidor valida a senha atual, comanda o Supabase Auth e confirma com o ticket de segurança emitido
    const confirmRes = await runAsUser<{ confirm_password_changed: boolean }>(
      USER_ADMIN_A,
      `SELECT public.confirm_password_changed('${TICKET_ADMIN_A}'::uuid);`
    );
    expect(confirmRes[0].confirm_password_changed).toBe(true);

    // O status no perfil agora é must_change_password = false e o ticket foi consumido
    const profileRes = await db.query<{ must_change_password: boolean; password_change_ticket: string | null }>(
      `SELECT must_change_password, password_change_ticket FROM public.profiles WHERE id = '${USER_ADMIN_A}';`
    );
    expect(profileRes.rows[0].must_change_password).toBe(false);
    expect(profileRes.rows[0].password_change_ticket).toBeNull();

    // Agora liberado: Administrador cria clientes e ordens de serviço normalmente
    const clientCreated = await runAsUser(
      USER_ADMIN_A,
      `INSERT INTO public.clients (company_id, name, document_type, document_number)
       VALUES ('${companyAId}', 'Cliente Criado Após Troca de Senha', 'CNPJ', '44.555.666/0001-77')
       RETURNING id;`
    );
    expect(clientCreated.length).toBe(1);
  });
});
