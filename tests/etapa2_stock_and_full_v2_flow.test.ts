import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ETAPA 2 V2 — Módulo Completo de Estoque, Baixa Automática em OS e Perfil Stock Manager', () => {
  let db: PGlite;

  const USER_PLATFORM_ADMIN = '00000000-0000-4000-8000-000000000000';
  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_STOCK_MGR_A = '55555555-5555-4555-8555-555555555555';
  const USER_TECNICO_A = '33333333-3333-4333-8333-333333333333';
  const USER_GESTOR_B = '22222222-2222-4222-8222-222222222222';
  const USER_TECNICO_B = '44444444-4444-4444-8444-444444444444';

  let companyAId = '';
  let companyBId = '';

  let clientA1Id = '';
  let eqA1_BalancaRodoviaria = '';
  let eqA1_BalancaPlataforma = '';

  let catItemId = '';
  let techAId = '';
  let centralLocationAId = '';
  let techLocationAId = '';

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

    // 1. Mock do schema de autenticação e storage do Supabase
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

    // 2. Executa a cadeia completa de migrações 001..010b
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/005_technician_invitation_system.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/008a_add_administrator_enum.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/008b_administrator_and_employee_auth.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/009_metrology_ordinance_and_multi_equipment_os.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/010a_add_stock_manager_enum.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/010b_stock_inventory_system.sql'), 'utf-8'));

    // 3. Configura Empresas de Teste
    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, is_active)
      VALUES ('Metrologia Brasil', 'Metrologia Brasil Ltda', 'metrologia-brasil', '99.888.777/0001-66', true)
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    // 4. Usuários e Membros com Perfil 'stock_manager'
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_PLATFORM_ADMIN}', 'superadmin@metrion.com.br'),
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br'),
        ('${USER_ADMIN_A}', 'carlos.admin.ea-balancas@auth.metrion.internal'),
        ('${USER_STOCK_MGR_A}', 'estoque@eabalancas.com.br'),
        ('${USER_TECNICO_A}', 'roberto.campo@eabalancas.com.br'),
        ('${USER_GESTOR_B}', 'gestor@metrobrasil.com.br'),
        ('${USER_TECNICO_B}', 'marcos.campo@metrobrasil.com.br');

      INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', 'gestor.ea', true),
        ('${companyAId}', '${USER_ADMIN_A}', 'administrator', 'carlos.admin', true),
        ('${companyAId}', '${USER_STOCK_MGR_A}', 'stock_manager', 'almoxarife.ea', true),
        ('${companyAId}', '${USER_TECNICO_A}', 'technician', 'roberto.tech', true),
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', 'gestor.b', true),
        ('${companyBId}', '${USER_TECNICO_B}', 'technician', 'marcos.tech', true);

      INSERT INTO public.profiles (id, full_name, email, default_company_id, must_change_password) VALUES
        ('${USER_GESTOR_A}', 'Eduardo Gestor', 'gestor@eabalancas.com.br', '${companyAId}', false),
        ('${USER_ADMIN_A}', 'Carlos Administrador', 'carlos.admin.ea-balancas@auth.metrion.internal', '${companyAId}', false),
        ('${USER_STOCK_MGR_A}', 'Marta Almoxarife', 'estoque@eabalancas.com.br', '${companyAId}', false),
        ('${USER_TECNICO_A}', 'Roberto Silva', 'roberto.campo@eabalancas.com.br', '${companyAId}', false),
        ('${USER_GESTOR_B}', 'Gestor Empresa B', 'gestor@metrobrasil.com.br', '${companyBId}', false),
        ('${USER_TECNICO_B}', 'Marcos Técnico B', 'marcos.campo@metrobrasil.com.br', '${companyBId}', false)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        default_company_id = EXCLUDED.default_company_id,
        must_change_password = EXCLUDED.must_change_password;
    `);

    // Inserção do Técnico (aciona trigger de auto-provisionamento de estoque móvel)
    const techRes = await db.query<{ id: string }>(`
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyAId}', '${USER_TECNICO_A}', 'Roberto Silva', 'roberto.campo@eabalancas.com.br', true)
      RETURNING id;
    `);
    techAId = techRes.rows[0].id;

    // Local Central e Local Móvel provisionados
    const centralRes = await db.query<{ id: string }>(`
      SELECT id FROM public.stock_locations WHERE company_id = '${companyAId}' AND location_type = 'central';
    `);
    centralLocationAId = centralRes.rows[0].id;

    const techLocRes = await db.query<{ id: string }>(`
      SELECT id FROM public.stock_locations WHERE company_id = '${companyAId}' AND technician_id = '${techAId}';
    `);
    techLocationAId = techLocRes.rows[0].id;

    // Clientes e Balanças
    const clA = await db.query<{ id: string }>(`
      INSERT INTO public.clients (company_id, name, document_type, document_number)
      VALUES ('${companyAId}', 'Agropecuária São João Ltda', 'CNPJ', '33.444.555/0001-88')
      RETURNING id;
    `);
    clientA1Id = clA.rows[0].id;

    const eq1 = await db.query<{ id: string }>(`
      INSERT INTO public.equipments (
        company_id, client_id, equipment_type, brand, model, serial_number, capacity_label, division_label, inmetro_ordinance
      ) VALUES (
        '${companyAId}', '${clientA1Id}', 'Balança Rodoviária', 'Toledo', '9091', 'TOD-9091-01', '80.000 kg', '20 kg', 'Portaria Inmetro 236/1994'
      ) RETURNING id;
    `);
    eqA1_BalancaRodoviaria = eq1.rows[0].id;

    const eq2 = await db.query<{ id: string }>(`
      INSERT INTO public.equipments (
        company_id, client_id, equipment_type, brand, model, serial_number, capacity_label, division_label, inmetro_ordinance
      ) VALUES (
        '${companyAId}', '${clientA1Id}', 'Balança de Bancada', 'Filizola', 'Plataforma BP-15', 'FLZ-BP15-02', '15 kg', '5 g', 'Portaria Inmetro 088/1987'
      ) RETURNING id;
    `);
    eqA1_BalancaPlataforma = eq2.rows[0].id;

    // Obtém item de catálogo oficial CAT-001
    const catRes = await db.query<{ id: string }>(`
      SELECT id FROM public.price_catalog_items WHERE company_id = '${companyAId}' AND code = 'CAT-001'
    `);
    catItemId = catRes.rows[0].id;
  });

  describe('1. Auto-provisionamento de Locais de Estoque', () => {
    it('1.1 Garante que o almoxarifado central foi criado automaticamente para Empresa A', () => {
      expect(centralLocationAId).toBeDefined();
      expect(centralLocationAId.length).toBeGreaterThan(10);
    });

    it('1.2 Garante que o estoque do veículo foi criado automaticamente para o Técnico A', () => {
      expect(techLocationAId).toBeDefined();
      expect(techLocationAId.length).toBeGreaterThan(10);
    });
  });

  describe('2. Entradas de Estoque e Cálculo de Custo Médio Ponderado', () => {
    it('2.1 Permite ao Almoxarife (stock_manager) dar entrada de 10 unidades de Teclado Toledo', async () => {
      const rows = await runAsUser<{ process_stock_entry: string }>(
        USER_STOCK_MGR_A,
        `SELECT public.process_stock_entry(
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10
        )`,
        [
          companyAId,
          centralLocationAId,
          catItemId,
          'CAT-001',
          'Teclado Prix5 plus/prix4 flex',
          'Teclados',
          10,
          250.00,
          'NF-99881',
          'Lote inicial importado'
        ]
      );

      expect(rows).toHaveLength(1);
      const moveId = rows[0].process_stock_entry;
      expect(moveId).toBeDefined();

      // Confere saldo e custos no almoxarifado central
      const itemCheck = await runAsUser<{ quantity: string; unit_cost: string }>(
        USER_STOCK_MGR_A,
        `SELECT quantity::text, unit_cost::text FROM public.inventory_items
          WHERE location_id = $1 AND item_code = $2`,
        [centralLocationAId, 'CAT-001']
      );
      expect(itemCheck[0].quantity).toBe('10.00');
      expect(itemCheck[0].unit_cost).toBe('250.00');
    });

    it('2.2 Registra movimentação de tipo entry vinculada ao responsável', async () => {
      const moves = await runAsUser<{ movement_type: string; quantity: string; invoice_number: string }>(
        USER_STOCK_MGR_A,
        `SELECT movement_type, quantity::text, invoice_number FROM public.stock_movements
          WHERE company_id = $1 AND item_code = 'CAT-001'`,
        [companyAId]
      );

      expect(moves.length).toBeGreaterThanOrEqual(1);
      expect(moves[0].movement_type).toBe('entry');
      expect(moves[0].quantity).toBe('10.00');
      expect(moves[0].invoice_number).toBe('NF-99881');
    });

    it('2.3 Calcula custo médio ponderado em nova entrada com preço diferente', async () => {
      // Nova entrada de 10 unidades a R$ 350. Custo médio: (10*250 + 10*350) / 20 = 6000 / 20 = 300.00
      await runAsUser(
        USER_STOCK_MGR_A,
        `SELECT public.process_stock_entry(
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10
        )`,
        [
          companyAId,
          centralLocationAId,
          catItemId,
          'CAT-001',
          'Teclado Prix5 plus/prix4 flex',
          'Teclados',
          10,
          350.00,
          'NF-99882',
          'Segundo lote'
        ]
      );

      const itemCheck = await runAsUser<{ quantity: string; unit_cost: string }>(
        USER_STOCK_MGR_A,
        `SELECT quantity::text, unit_cost::text FROM public.inventory_items
          WHERE location_id = $1 AND item_code = 'CAT-001'`,
        [centralLocationAId]
      );
      expect(itemCheck[0].quantity).toBe('20.00');
      expect(Number(itemCheck[0].unit_cost)).toBe(300.00);
    });
  });

  describe('3. Transferência de Estoque (Almoxarifado Central -> Veículo do Técnico)', () => {
    it('3.1 Rejeita transferência se o saldo na origem for insuficiente', async () => {
      await expect(
        runAsUser(
          USER_STOCK_MGR_A,
          `SELECT public.process_stock_transfer($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
          [
            companyAId,
            centralLocationAId,
            techLocationAId,
            'CAT-001',
            50, // Saldo é 20
            'Tentativa com saldo insuficiente'
          ]
        )
      ).rejects.toThrow(/Saldo insuficiente/i);
    });

    it('3.2 Executa transferência com sucesso de 4 unidades para a viatura do técnico', async () => {
      const res = await runAsUser<{ process_stock_transfer: boolean }>(
        USER_STOCK_MGR_A,
        `SELECT public.process_stock_transfer($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
        [
          companyAId,
          centralLocationAId,
          techLocationAId,
          'CAT-001',
          4,
          'Carga inicial viatura Roberto'
        ]
      );

      expect(res[0].process_stock_transfer).toBe(true);

      // Central deve ficar com 16 unidades
      const centralBalance = await runAsUser<{ quantity: string }>(
        USER_STOCK_MGR_A,
        `SELECT quantity::text FROM public.inventory_items
          WHERE location_id = $1 AND item_code = 'CAT-001'`,
        [centralLocationAId]
      );
      expect(centralBalance[0].quantity).toBe('16.00');

      // Viatura do técnico deve ter agora 4 unidades
      const techBalance = await runAsUser<{ quantity: string }>(
        USER_STOCK_MGR_A,
        `SELECT quantity::text FROM public.inventory_items
          WHERE location_id = $1 AND item_code = 'CAT-001'`,
        [techLocationAId]
      );
      expect(techBalance[0].quantity).toBe('4.00');
    });

    it('3.3 Registra histórico pareado de transfer_out e transfer_in', async () => {
      const moves = await runAsUser<{ movement_type: string; quantity: string }>(
        USER_STOCK_MGR_A,
        `SELECT movement_type, quantity::text FROM public.stock_movements
          WHERE company_id = $1 AND item_code = 'CAT-001' AND movement_type LIKE 'transfer%'
          ORDER BY created_at DESC LIMIT 2`,
        [companyAId]
      );

      expect(moves).toHaveLength(2);
      const types = moves.map((m) => m.movement_type);
      expect(types).toContain('transfer_out');
      expect(types).toContain('transfer_in');
    });
  });

  describe('4. Ordem de Serviço com Múltiplas Balanças e Baixa Automática de Peças', () => {
    let orderId = '';
    let osItemId = '';

    it('4.1 Cria uma OS com balança principal e vincula segunda balança na tabela service_order_equipments', async () => {
      const osRes = await runAsUser<{ id: string }>(
        USER_GESTOR_A,
        `INSERT INTO public.service_orders (
          company_id, client_id, equipment_id, primary_technician_id,
          order_type, priority, status, title, reported_issue
        ) VALUES (
          $1, $2, $3, $4, 'corrective', 'high', 'in_progress', 'Manutenção Balança Rodoviária', 'Pesagem oscilando com carga pesada'
        ) RETURNING id`,
        [companyAId, clientA1Id, eqA1_BalancaRodoviaria, techAId]
      );
      orderId = osRes[0].id;
      expect(orderId).toBeDefined();

      // Vincula a segunda balança do cliente na mesma OS
      const linkRes = await runAsUser<{ id: string }>(
        USER_GESTOR_A,
        `INSERT INTO public.service_order_equipments (
          company_id, service_order_id, equipment_id, notes
        ) VALUES ($1, $2, $3, 'Balança de apoio para conferência de calibração')
        RETURNING id`,
        [companyAId, orderId, eqA1_BalancaPlataforma]
      );
      expect(linkRes[0].id).toBeDefined();
    });

    it('4.2 Adiciona peça na OS com status proposed (sem afetar saldo de estoque ainda)', async () => {
      const itemRes = await runAsUser<{ id: string }>(
        USER_TECNICO_A,
        `INSERT INTO public.service_order_items (
          service_order_id, catalog_item_id, item_code, description, category, quantity, unit_price, payment_modality
        ) VALUES (
          $1, $2, 'CAT-001', 'Teclado Prix5 plus/prix4 flex/prix4 due/prix4 uno', 'Teclados', 2.00, 370.51, 'cash'
        ) RETURNING id`,
        [orderId, catItemId]
      );
      osItemId = itemRes[0].id;
      expect(osItemId).toBeDefined();

      // Saldo do técnico continua intacto (4 unidades)
      const techBal = await runAsUser<{ quantity: string }>(
        USER_STOCK_MGR_A,
        `SELECT quantity::text FROM public.inventory_items WHERE location_id = $1 AND item_code = 'CAT-001'`,
        [techLocationAId]
      );
      expect(techBal[0].quantity).toBe('4.00');
    });

    it('4.3 Ao autorizar e aplicar a peça, trigger realiza baixa automática no estoque do veículo', async () => {
      // Gestor autoriza
      await runAsUser(
        USER_GESTOR_A,
        `UPDATE public.service_order_items
            SET item_status = 'authorized'
          WHERE id = $1`,
        [osItemId]
      );

      // Técnico aplica em campo
      await runAsUser(
        USER_TECNICO_A,
        `UPDATE public.service_order_items
            SET item_status = 'applied'
          WHERE id = $1`,
        [osItemId]
      );

      // Saldo do veículo do técnico deve ser deduzido em 2 unidades (4 - 2 = 2)
      const techBal = await runAsUser<{ quantity: string }>(
        USER_STOCK_MGR_A,
        `SELECT quantity::text FROM public.inventory_items WHERE location_id = $1 AND item_code = 'CAT-001'`,
        [techLocationAId]
      );
      expect(techBal[0].quantity).toBe('2.00');

      // Movimento de consumption deve ter sido registrado
      const moves = await runAsUser<{ movement_type: string; quantity: string; service_order_id: string }>(
        USER_STOCK_MGR_A,
        `SELECT movement_type, quantity::text, service_order_id
           FROM public.stock_movements
          WHERE service_order_item_id = $1`,
        [osItemId]
      );
      expect(moves).toHaveLength(1);
      expect(moves[0].movement_type).toBe('consumption');
      expect(moves[0].quantity).toBe('2.00');
      expect(moves[0].service_order_id).toBe(orderId);
    });

    it('4.4 Idempotência estrita: re-executar update não duplica a baixa nem decrementa estoque novamente', async () => {
      // Gestor atualiza notas complementares do item
      await runAsUser(
        USER_GESTOR_A,
        `UPDATE public.service_order_items
            SET notes = 'Atualização de nota complementar',
                updated_at = now()
          WHERE id = $1`,
        [osItemId]
      );

      // Saldo do técnico continua rigorosamente em 2.00
      const techBal = await runAsUser<{ quantity: string }>(
        USER_STOCK_MGR_A,
        `SELECT quantity::text FROM public.inventory_items WHERE location_id = $1 AND item_code = 'CAT-001'`,
        [techLocationAId]
      );
      expect(techBal[0].quantity).toBe('2.00');

      // Exatamente 1 movimentação registrada para este item
      const countRes = await runAsUser<{ cnt: string }>(
        USER_STOCK_MGR_A,
        `SELECT count(*)::text as cnt FROM public.stock_movements WHERE service_order_item_id = $1`,
        [osItemId]
      );
      expect(countRes[0].cnt).toBe('1');
    });
  });

  describe('5. Alertas de Estoque Baixo (get_low_stock_alerts)', () => {
    it('5.1 Identifica itens cujo saldo atingiu ou ficou abaixo do estoque mínimo', async () => {
      // Cadastra um item com saldo 1 e estoque mínimo padrão 2
      await runAsUser(
        USER_STOCK_MGR_A,
        `SELECT public.process_stock_entry(
          $1::uuid, $2::uuid, NULL::uuid, $3, $4, $5, $6, $7, $8, $9
        )`,
        [
          companyAId,
          centralLocationAId,
          'IND-WT3000',
          'Indicador Digital WT3000',
          'Eletrônicos',
          1,
          1200.00,
          'NF-555',
          'Última unidade'
        ]
      );

      const alerts = await runAsUser<{ item_code: string; current_quantity: string; min_quantity: string }>(
        USER_STOCK_MGR_A,
        `SELECT item_code, current_quantity::text, min_quantity::text
           FROM public.get_low_stock_alerts($1::uuid)`,
        [companyAId]
      );

      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const found = alerts.find((a) => a.item_code === 'IND-WT3000');
      expect(found).toBeDefined();
      expect(found?.current_quantity).toBe('1.00');
      expect(found?.min_quantity).toBe('2.00');
    });
  });

  describe('6. Isolamento Multi-tenant e Segurança de Acesso a Estoque', () => {
    it('6.1 Usuário da Empresa B não consegue visualizar saldos de estoque da Empresa A', async () => {
      const itemsCompB = await runAsUser(
        USER_GESTOR_B,
        `SELECT * FROM public.inventory_items WHERE company_id = $1`,
        [companyAId]
      );
      expect(itemsCompB).toHaveLength(0);
    });

    it('6.2 Usuário da Empresa B não consegue transferir itens do almoxarifado da Empresa A', async () => {
      await expect(
        runAsUser(
          USER_GESTOR_B,
          `SELECT public.process_stock_transfer($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
          [
            companyAId,
            centralLocationAId,
            techLocationAId,
            'CEL-500KG',
            1,
            'Tentativa indevida'
          ]
        )
      ).rejects.toThrow();
    });

    it('6.3 Usuário com role stock_manager possui acesso garantido para auditar movimentos da sua empresa', async () => {
      const moves = await runAsUser(
        USER_STOCK_MGR_A,
        `SELECT id, item_code, movement_type FROM public.stock_movements WHERE company_id = $1`,
        [companyAId]
      );
      expect(moves.length).toBeGreaterThanOrEqual(3);
    });
  });
});
