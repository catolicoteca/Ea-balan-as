import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Price Catalog & Service Order Items - Advanced Security Audit', () => {
  let db: PGlite;

  const USER_ADMIN = '11111111-1111-4111-8111-111111111111';
  const USER_MGR_A = '22222222-2222-4222-8222-222222222222';
  const USER_TECH_A1 = '33333333-3333-4333-8333-333333333333';
  const USER_TECH_A2 = '44444444-4444-4444-8444-444444444444';
  const USER_MGR_B = '55555555-5555-4555-8555-555555555555';

  let companyAId = '';
  let companyBId = '';
  let osA1Id = '';
  let osA2Id = '';
  let catalogItemBId = '';
  let equipBId = '';
  let equipA1Id = '';
  let equipA2Id = '';

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

    // Setup base mock Supabase roles & auth schema
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

    // 1. Aplica a migração 001_initial_schema.sql
    const sql001 = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql'),
      'utf-8'
    );
    await db.exec(sql001);

    // 2. Aplica a migração incremental 003_price_catalog.sql
    const sql003 = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/003_price_catalog.sql'),
      'utf-8'
    );
    await db.exec(sql003);

    // 3. Cadastra os usuários no mock auth.users
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_ADMIN}', 'admin@eabalancas.com.br'),
        ('${USER_MGR_A}', 'gestor@empresa-a.com.br'),
        ('${USER_TECH_A1}', 'tecnico1@empresa-a.com.br'),
        ('${USER_TECH_A2}', 'tecnico2@empresa-a.com.br'),
        ('${USER_MGR_B}', 'gestor@empresa-b.com.br');
    `);

    // Bootstrap Empresa A (EA Balanças)
    await runAsUser(USER_ADMIN, `
      SELECT public.bootstrap_initial_platform(
        'EA Balanças',
        '00.000.000/0001-91',
        'Administrador Chefe'
      );
    `);

    const compRows = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compRows.rows[0].id;

    // Vincula Gestor A e Técnicos A1, A2
    await db.exec(`
      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES
        ('${companyAId}', '${USER_MGR_A}', 'manager', true),
        ('${companyAId}', '${USER_TECH_A1}', 'technician', true),
        ('${companyAId}', '${USER_TECH_A2}', 'technician', true);

      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active) VALUES
        ('${companyAId}', '${USER_TECH_A1}', 'Técnico Um', 'tecnico1@empresa-a.com.br', true),
        ('${companyAId}', '${USER_TECH_A2}', 'Técnico Dois', 'tecnico2@empresa-a.com.br', true);
    `);

    // Empresa B (concorrente)
    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, is_active)
      VALUES ('Empresa B Metrologia', 'Empresa B Ltda', 'empresa-b', true)
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    await db.exec(`
      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES
        ('${companyBId}', '${USER_MGR_B}', 'manager', true);
    `);

    // Itens e equipamentos da Empresa B
    const catB = await runAsUser<{ id: string }>(USER_MGR_B, `
      INSERT INTO public.price_catalog_items (company_id, code, category, description, price_term, price_cash)
      VALUES ('${companyBId}', 'CAT-B01', 'Placas', 'Placa Mãe Empresa B', 500.00, 450.00)
      RETURNING id;
    `);
    catalogItemBId = catB[0].id;

    const clientB = await runAsUser<{ id: string }>(USER_MGR_B, `
      INSERT INTO public.clients (company_id, name) VALUES ('${companyBId}', 'Padaria B') RETURNING id;
    `);

    const eqB = await runAsUser<{ id: string }>(USER_MGR_B, `
      INSERT INTO public.equipments (company_id, client_id, brand, model, serial_number)
      VALUES ('${companyBId}', '${clientB[0].id}', 'Toledo', 'Prix 3 B', 'SN-B-001')
      RETURNING id;
    `);
    equipBId = eqB[0].id;

    // Cria cliente e equipamentos da Empresa A
    const clientA = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.clients (company_id, name) VALUES ('${companyAId}', 'Supermercado Modelo') RETURNING id;
    `);

    const eqA1 = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.equipments (company_id, client_id, brand, model, serial_number)
      VALUES ('${companyAId}', '${clientA[0].id}', 'Toledo', 'Prix 5 Plus', 'SN-A-001')
      RETURNING id;
    `);
    equipA1Id = eqA1[0].id;

    const eqA2 = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.equipments (company_id, client_id, brand, model, serial_number)
      VALUES ('${companyAId}', '${clientA[0].id}', 'Filizola', 'Platina', 'SN-A-002')
      RETURNING id;
    `);
    equipA2Id = eqA2[0].id;

    const techA1Record = await db.query<{ id: string }>(`
      SELECT id FROM public.technicians WHERE user_id = '${USER_TECH_A1}'
    `);

    // OS 1 com equipamento fixado: equipA1Id
    const os1 = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.service_orders (company_id, client_id, equipment_id, primary_technician_id, title, reported_issue, status)
      VALUES ('${companyAId}', '${clientA[0].id}', '${equipA1Id}', '${techA1Record.rows[0].id}', 'Troca de Teclado Prix 5', 'Teclas travando', 'open')
      RETURNING id;
    `);
    osA1Id = os1[0].id;

    // OS 2 (sem atribuição a A1, restrita)
    const os2 = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.service_orders (company_id, client_id, title, reported_issue, status)
      VALUES ('${companyAId}', '${clientA[0].id}', 'Manutenção Geral Filizola', 'Calibração anual', 'open')
      RETURNING id;
    `);
    osA2Id = os2[0].id;

    // Cadastra item oficial no catálogo da Empresa A
    await runAsUser(USER_MGR_A, `
      INSERT INTO public.price_catalog_items (
        company_id, code, category, description, condition, price_term, price_cash
      ) VALUES (
        '${companyAId}', 'CAT-001', 'Teclados', 'Teclado Prix5 plus', 'Nova', 390.02, 370.51
      );
    `);
  });

  it('1. RLS: tabelas criadas com segurança ativa', async () => {
    const res = await db.query<{ tablename: string; rowsecurity: boolean }>(`
      SELECT tablename, rowsecurity FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('price_catalog_items', 'service_order_items', 'price_catalog_imports');
    `);

    expect(res.rows).toHaveLength(3);
    for (const row of res.rows) {
      expect(row.rowsecurity).toBe(true);
    }
  });

  it('2. Gestor gerencia catálogo e técnico tem permissão APENAS de leitura', async () => {
    // Técnico lê
    const items = await runAsUser<{ code: string }>(USER_TECH_A1, `
      SELECT code FROM public.price_catalog_items WHERE company_id = '${companyAId}';
    `);
    expect(items.length).toBeGreaterThan(0);

    // Técnico tenta inserir -> bloqueado por RLS
    await expect(
      runAsUser(USER_TECH_A1, `
        INSERT INTO public.price_catalog_items (company_id, code, category, description, price_term, price_cash)
        VALUES ('${companyAId}', 'HACK-01', 'PCI', 'Invasão', 10, 10);
      `)
    ).rejects.toThrow();
  });

  it('3. Preço e Desconto: o banco IMPÕE o valor oficial do catálogo e ZERA desconto para técnicos', async () => {
    // Técnico tenta enviar unit_price manipulado (R$ 5,00 em vez de R$ 370,51) e desconto de R$ 20,00
    const res = await runAsUser<{ unit_price: string; discount_amount: string; total_price: string; item_status: string }>(
      USER_TECH_A1,
      `
      INSERT INTO public.service_order_items (
        service_order_id, item_code, description, category,
        condition, payment_modality, quantity, unit_price, discount_amount, item_status
      ) VALUES (
        '${osA1Id}', 'CAT-001', 'Teclado Prix5 plus', 'Teclados',
        'Nova', 'cash', 2, 5.00, 20.00, 'authorized'
      ) RETURNING unit_price, discount_amount, total_price, item_status;
    `
    );

    expect(res).toHaveLength(1);
    expect(Number(res[0].unit_price)).toBe(370.51);
    expect(Number(res[0].discount_amount)).toBe(0.00);
    expect(Number(res[0].total_price)).toBe(741.02);
    expect(res[0].item_status).toBe('proposed');
  });

  it('4. Técnico NÃO PODE adicionar peça com código inexistente no catálogo oficial', async () => {
    await expect(
      runAsUser(USER_TECH_A1, `
        INSERT INTO public.service_order_items (
          service_order_id, item_code, description, category,
          condition, payment_modality, quantity, unit_price
        ) VALUES (
          '${osA1Id}', 'COD-INVENTADO', 'Serviço Fantasma', 'Geral',
          'Nova', 'cash', 1, 100.00
        );
      `)
    ).rejects.toThrow(/Técnicos só podem adicionar peças e serviços cadastrados no catálogo oficial/);
  });

  it('5. Validação Cross-tenant: BLOQUEIA vincular catálogo ou equipamento da Empresa B na OS da Empresa A', async () => {
    // Tentativa com item de catálogo da Empresa B
    await expect(
      runAsUser(USER_MGR_A, `
        INSERT INTO public.service_order_items (
          service_order_id, catalog_item_id, item_code, description,
          payment_modality, quantity, unit_price
        ) VALUES (
          '${osA1Id}', '${catalogItemBId}', 'CAT-B01', 'Item Cross-Tenant',
          'cash', 1, 500.00
        );
      `)
    ).rejects.toThrow(/Violação multiempresa: o item de catálogo informado pertence a outra empresa/);

    // Tentativa com equipamento da Empresa B
    await expect(
      runAsUser(USER_MGR_A, `
        INSERT INTO public.service_order_items (
          service_order_id, equipment_id, item_code, description,
          payment_modality, quantity, unit_price
        ) VALUES (
          '${osA1Id}', '${equipBId}', 'CAT-001', 'Item Com Equip de Outra Empresa',
          'cash', 1, 370.51
        );
      `)
    ).rejects.toThrow(/Violação multiempresa: o equipamento informado pertence a outra empresa/);
  });

  it('6. Validação de Equipamento: BLOQUEIA vincular equipamento diferente do vinculado à OS', async () => {
    // osA1Id tem o equipamento equipA1Id. Tentar vincular equipA2Id deve ser rejeitado!
    await expect(
      runAsUser(USER_TECH_A1, `
        INSERT INTO public.service_order_items (
          service_order_id, equipment_id, item_code, description, payment_modality, quantity
        ) VALUES (
          '${osA1Id}', '${equipA2Id}', 'CAT-001', 'Teclado Prix 5', 'cash', 1
        );
      `)
    ).rejects.toThrow(/não corresponde ao equipamento vinculado a esta Ordem de Serviço/);
  });

  it('7. Técnico NÃO CONSEGUE adicionar itens em OS de outros técnicos', async () => {
    await expect(
      runAsUser(USER_TECH_A1, `
        INSERT INTO public.service_order_items (
          service_order_id, item_code, description, payment_modality, quantity
        ) VALUES (
          '${osA2Id}', 'CAT-001', 'Teclado Prix5', 'cash', 1
        );
      `)
    ).rejects.toThrow();
  });

  it('8. Somente Gestor aprova itens; técnico é bloqueado', async () => {
    const items = await runAsUser<{ id: string }>(USER_TECH_A1, `
      SELECT id FROM public.service_order_items WHERE service_order_id = '${osA1Id}';
    `);
    const itemId = items[0].id;

    // Técnico tenta aprovar -> Bloqueado com exceção
    await expect(
      runAsUser(USER_TECH_A1, `
        UPDATE public.service_order_items SET item_status = 'authorized' WHERE id = '${itemId}';
      `)
    ).rejects.toThrow(/Apenas gestores têm permissão para aprovar itens/);

    // Gestor aprova com sucesso
    await runAsUser(USER_MGR_A, `
      UPDATE public.service_order_items SET item_status = 'authorized' WHERE id = '${itemId}';
    `);

    const checked = await runAsUser<{ item_status: string; authorized_by: string }>(USER_MGR_A, `
      SELECT item_status, authorized_by FROM public.service_order_items WHERE id = '${itemId}';
    `);
    expect(checked[0].item_status).toBe('authorized');
    expect(checked[0].authorized_by).toBe(USER_MGR_A);
  });

  it('9. Item só pode ser marcado como aplicado após ser autorizado e banco preenche applied_by', async () => {
    const items = await runAsUser<{ id: string }>(USER_TECH_A1, `
      SELECT id FROM public.service_order_items WHERE service_order_id = '${osA1Id}';
    `);
    const itemId = items[0].id;

    // Técnico marca o item previamente autorizado como aplicado
    await runAsUser(USER_TECH_A1, `
      UPDATE public.service_order_items SET item_status = 'applied' WHERE id = '${itemId}';
    `);

    const applied = await runAsUser<{ item_status: string; applied_by: string; applied_at: string }>(
      USER_TECH_A1,
      `
      SELECT item_status, applied_by, applied_at FROM public.service_order_items WHERE id = '${itemId}';
    `
    );
    expect(applied[0].item_status).toBe('applied');
    // Preenchido compulsoriamente pelo banco com o id do técnico autenticado
    expect(applied[0].applied_by).toBe(USER_TECH_A1);
    expect(applied[0].applied_at).toBeTruthy();
  });

  it('10. Bloqueio de campos protegidos: técnico NÃO PODE alterar service_order_id, company_id, created_by, authorized_by, applied_by', async () => {
    // Insere proposta própria
    const prop = await runAsUser<{ id: string }>(USER_TECH_A1, `
      INSERT INTO public.service_order_items (
        service_order_id, item_code, description, payment_modality, quantity
      ) VALUES (
        '${osA1Id}', 'CAT-001', 'Proposta Campos Protegidos', 'cash', 1
      ) RETURNING id;
    `);
    const propId = prop[0].id;

    // Técnico tenta alterar service_order_id
    await expect(
      runAsUser(USER_TECH_A1, `
        UPDATE public.service_order_items SET service_order_id = '${osA2Id}' WHERE id = '${propId}';
      `)
    ).rejects.toThrow(/Técnicos não têm permissão para alterar a Ordem de Serviço/);

    // Técnico tenta alterar created_by
    await expect(
      runAsUser(USER_TECH_A1, `
        UPDATE public.service_order_items SET created_by = '${USER_MGR_A}' WHERE id = '${propId}';
      `)
    ).rejects.toThrow(/O autor original \(created_by\) do item não pode ser alterado/);

    // Técnico tenta alterar authorized_by
    await expect(
      runAsUser(USER_TECH_A1, `
        UPDATE public.service_order_items SET authorized_by = '${USER_MGR_A}' WHERE id = '${propId}';
      `)
    ).rejects.toThrow(/Técnicos não têm permissão para manipular dados de autorização/);
  });

  it('11. Bloqueio de vínculos pós-autorização inclusive para gestores (service_order_id, catalog_item_id, equipment_id)', async () => {
    const itemAuth = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.service_order_items (
        service_order_id, item_code, description, payment_modality, quantity, unit_price, item_status
      ) VALUES (
        '${osA1Id}', 'CAT-001', 'Item Autorizado Gestor', 'cash', 1, 370.51, 'authorized'
      ) RETURNING id;
    `);
    const authId = itemAuth[0].id;

    // Gestor tenta transferir peça autorizada para outra OS -> Bloqueado!
    await expect(
      runAsUser(USER_MGR_A, `
        UPDATE public.service_order_items SET service_order_id = '${osA2Id}' WHERE id = '${authId}';
      `)
    ).rejects.toThrow(/Itens autorizados ou aplicados não podem ser transferidos para outra Ordem de Serviço/);
  });

  it('12. Restrição de DELETE: técnico NÃO PODE excluir itens autorizados ou aplicados', async () => {
    const items = await runAsUser<{ id: string }>(USER_TECH_A1, `
      SELECT id FROM public.service_order_items WHERE service_order_id = '${osA1Id}' AND item_status = 'applied';
    `);
    const itemId = items[0].id;

    // Tentativa do técnico de excluir item aplicado
    await runAsUser(USER_TECH_A1, `
      DELETE FROM public.service_order_items WHERE id = '${itemId}';
    `);

    // A política RLS bloqueou a exclusão e o item permanece intacto
    const stillExists = await runAsUser(USER_MGR_A, `
      SELECT id FROM public.service_order_items WHERE id = '${itemId}';
    `);
    expect(stillExists).toHaveLength(1);
  });

  it('13. Restrição de DELETE: técnico PODE excluir propostas próprias ainda não autorizadas', async () => {
    const prop = await runAsUser<{ id: string }>(USER_TECH_A1, `
      INSERT INTO public.service_order_items (
        service_order_id, item_code, description, payment_modality, quantity
      ) VALUES (
        '${osA1Id}', 'CAT-001', 'Proposta de Teste', 'cash', 1
      ) RETURNING id;
    `);

    await runAsUser(USER_TECH_A1, `
      DELETE FROM public.service_order_items WHERE id = '${prop[0].id}';
    `);

    const deleted = await runAsUser(USER_MGR_A, `
      SELECT id FROM public.service_order_items WHERE id = '${prop[0].id}';
    `);
    expect(deleted).toHaveLength(0);
  });

  it('14. Transição authorized -> applied: ignora applied_by/applied_at enviados pelo cliente e preenche no banco', async () => {
    // Gestor insere e autoriza um item para teste
    const inserted = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.service_order_items (
        service_order_id, item_code, description, payment_modality, quantity, unit_price, item_status
      ) VALUES (
        '${osA1Id}', 'CAT-001', 'Item Para Teste Spoofing Applied', 'cash', 1, 370.51, 'authorized'
      ) RETURNING id;
    `);
    const itemId = inserted[0].id;

    // Técnico tenta enviar status 'applied' injetando applied_by forjado e applied_at no passado
    const FORGED_USER_ID = '99999999-9999-4999-8999-999999999999';
    const FORGED_TIMESTAMP = '2020-01-01 12:00:00+00';

    await runAsUser(USER_TECH_A1, `
      UPDATE public.service_order_items
         SET item_status = 'applied',
             applied_by = '${FORGED_USER_ID}',
             applied_at = '${FORGED_TIMESTAMP}'
       WHERE id = '${itemId}';
    `);

    // Consulta o registro no banco: os valores do cliente DEVEM ter sido ignorados e substituídos pelo banco
    const result = await runAsUser<{ item_status: string; applied_by: string; applied_at: string }>(
      USER_MGR_A,
      `SELECT item_status, applied_by, applied_at FROM public.service_order_items WHERE id = '${itemId}';`
    );

    expect(result[0].item_status).toBe('applied');
    // Preenchido compulsoriamente com auth.uid() do técnico que executou a ação
    expect(result[0].applied_by).toBe(USER_TECH_A1);
    expect(result[0].applied_by).not.toBe(FORGED_USER_ID);
    // Preenchido compulsoriamente com now(), não com a data forjada de 2020
    expect(result[0].applied_at).not.toBe(FORGED_TIMESTAMP);
    expect(new Date(result[0].applied_at).getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it('15. Bloqueio de atualizações sem mudança de status em itens authorized ou applied feitas por técnicos', async () => {
    // Cria item em estado authorized
    const inserted = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.service_order_items (
        service_order_id, item_code, description, payment_modality, quantity, unit_price, item_status
      ) VALUES (
        '${osA1Id}', 'CAT-001', 'Item Authorized Sem Mudança', 'cash', 1, 370.51, 'authorized'
      ) RETURNING id;
    `);
    const authItemId = inserted[0].id;

    // 15.1: Técnico tenta alterar quantidade mantendo status 'authorized' -> Bloqueado com exceção
    await expect(
      runAsUser(USER_TECH_A1, `
        UPDATE public.service_order_items
           SET quantity = 5
         WHERE id = '${authItemId}';
      `)
    ).rejects.toThrow(/Técnicos não têm permissão para atualizar itens autorizados sem realizar a transição de status para aplicado/);

    // 15.2: Técnico tenta alterar notes mantendo status 'authorized' -> Bloqueado com exceção
    await expect(
      runAsUser(USER_TECH_A1, `
        UPDATE public.service_order_items
           SET notes = 'Observação técnica não autorizada'
         WHERE id = '${authItemId}';
      `)
    ).rejects.toThrow(/Técnicos não têm permissão para atualizar itens autorizados sem realizar a transição de status para aplicado/);

    // Agora técnico realiza a transição legítima para 'applied'
    await runAsUser(USER_TECH_A1, `
      UPDATE public.service_order_items
         SET item_status = 'applied'
       WHERE id = '${authItemId}';
    `);

    // 15.3: Técnico tenta qualquer alteração em item já 'applied' -> Bloqueado como estado terminal
    await expect(
      runAsUser(USER_TECH_A1, `
        UPDATE public.service_order_items
           SET notes = 'Tentativa em item aplicado'
         WHERE id = '${authItemId}';
      `)
    ).rejects.toThrow(/Itens já aplicados não podem ser alterados por técnicos/);
  });

  it('16. Alterações posteriores no catálogo oficial NÃO modificam valores históricos de itens autorizados ou aplicados', async () => {
    // Cadastra item com código exclusivo no catálogo oficial da empresa A
    const catItem = await runAsUser<{ id: string }>(USER_MGR_A, `
      INSERT INTO public.price_catalog_items (
        company_id, code, description, category, price_cash, price_term, is_active
      ) VALUES (
        '${companyAId}', 'CAT-HIST-01', 'Teclado Histórico Protegido', 'Teclados', 250.00, 300.00, true
      ) RETURNING id;
    `);
    const catId = catItem[0].id;

    // Técnico propõe a peça na OS (preço oficial 250.00 à vista)
    const orderItem = await runAsUser<{ id: string; unit_price: string; total_price: string }>(USER_TECH_A1, `
      INSERT INTO public.service_order_items (
        service_order_id, catalog_item_id, item_code, description, payment_modality, quantity
      ) VALUES (
        '${osA1Id}', '${catId}', 'CAT-HIST-01', 'Teclado Histórico Protegido', 'cash', 2
      ) RETURNING id, unit_price, total_price;
    `);
    const orderItemId = orderItem[0].id;
    expect(Number(orderItem[0].unit_price)).toBe(250.00);
    expect(Number(orderItem[0].total_price)).toBe(500.00);

    // Gestor autoriza o item no orçamento
    await runAsUser(USER_MGR_A, `
      UPDATE public.service_order_items
         SET item_status = 'authorized'
       WHERE id = '${orderItemId}';
    `);

    // Gestor atualiza o catálogo oficial com NOVO preço (inflacionado para 450.00 à vista / 550.00 a prazo)
    await runAsUser(USER_MGR_A, `
      UPDATE public.price_catalog_items
         SET price_cash = 450.00,
             price_term = 550.00
       WHERE id = '${catId}';
    `);

    // Verifica que o item autorizado na OS MANTÉM rigorosamente os valores históricos originais (250.00 / 500.00)
    const afterCatalogUpdate = await runAsUser<{ unit_price: string; total_price: string }>(USER_MGR_A, `
      SELECT unit_price, total_price FROM public.service_order_items WHERE id = '${orderItemId}';
    `);
    expect(Number(afterCatalogUpdate[0].unit_price)).toBe(250.00);
    expect(Number(afterCatalogUpdate[0].total_price)).toBe(500.00);

    // Técnico transiciona o item para 'applied'
    await runAsUser(USER_TECH_A1, `
      UPDATE public.service_order_items
         SET item_status = 'applied'
       WHERE id = '${orderItemId}';
    `);

    // Verifica que após ser aplicado, o item CONTINUA preservando os valores históricos originais
    const afterApplied = await runAsUser<{ unit_price: string; total_price: string; item_status: string }>(USER_MGR_A, `
      SELECT unit_price, total_price, item_status FROM public.service_order_items WHERE id = '${orderItemId}';
    `);
    expect(afterApplied[0].item_status).toBe('applied');
    expect(Number(afterApplied[0].unit_price)).toBe(250.00);
    expect(Number(afterApplied[0].total_price)).toBe(500.00);
  });
});
