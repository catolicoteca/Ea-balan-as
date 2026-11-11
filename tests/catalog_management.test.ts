import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { priceCatalogItemSchema } from '../src/lib/validation';

describe('Gerenciamento do Catálogo de Produtos, Peças e Serviços (EA Balanças)', () => {
  let db: PGlite;

  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_TECNICO_A = '22222222-2222-4222-8222-222222222222';
  const USER_GESTOR_B = '33333333-3333-4333-8333-333333333333';

  let companyAId = '';
  let companyBId = '';
  let techAId = '';
  let osAId = '';
  let cat001Id = '';
  let newItemId = '';

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
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text UNIQUE,
        email_confirmed_at timestamptz DEFAULT now(),
        confirmed_at timestamptz DEFAULT now(),
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

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
    `);

    // Aplica migrações 001, 003, 004 e 006 (auditoria do catálogo)
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/006_price_catalog_audit.sql'), 'utf-8'));

    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, phone, email, sidebar_color)
      VALUES ('Outra Empresa', 'Outra Ltda', 'outra-empresa', '66.555.444/0001-33', '(11) 3000-0001', 'contato@outra.com.br', '#0B2545')
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br'),
        ('${USER_TECNICO_A}', 'tecnico@eabalancas.com.br'),
        ('${USER_GESTOR_B}', 'gestor@outra.com.br');

      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', true),
        ('${companyAId}', '${USER_TECNICO_A}', 'technician', true),
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', true);
    `);

    const tA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyAId}', '${USER_TECNICO_A}', 'Técnico EA', 'tecnico@eabalancas.com.br', true)
      RETURNING id;
    `);
    techAId = tA[0].id;

    const cA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.clients (company_id, name, trade_name, document_type, document_number)
      VALUES ('${companyAId}', 'Supermercado Exemplo', 'Super Exemplo', 'CNPJ', '11.222.333/0001-88')
      RETURNING id;
    `);
    const uA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.client_units (company_id, client_id, unit_name, street, city, state)
      VALUES ('${companyAId}', '${cA[0].id}', 'Matriz', 'Av. Central, 10', 'Campinas', 'SP')
      RETURNING id;
    `);
    const eA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.equipments (company_id, client_id, unit_id, brand, model, serial_number)
      VALUES ('${companyAId}', '${cA[0].id}', '${uA[0].id}', 'Toledo', 'Prix 5 Plus', 'SN-CAT-TEST')
      RETURNING id;
    `);

    const osRes = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.service_orders (
        company_id, sequence_number, order_number, client_id, unit_id, equipment_id,
        primary_technician_id, title, reported_issue, status, priority, created_by
      ) VALUES (
        '${companyAId}', 50, 'OS-2026-0050', '${cA[0].id}', '${uA[0].id}', '${eA[0].id}',
        '${techAId}', 'Substituição de Teclado', 'Teclado falhando', 'in_progress', 'medium', '${USER_GESTOR_A}'
      ) RETURNING id;
    `);
    osAId = osRes[0].id;

    const catRow = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      SELECT id FROM public.price_catalog_items WHERE company_id = '${companyAId}' AND code = 'CAT-001';
    `);
    cat001Id = catRow[0].id;
  });

  it('1. Validação Zod do formulário de catálogo valida preços, código e descrição', () => {
    const valid = priceCatalogItemSchema.safeParse({
      code: 'SRV-001',
      category: 'Serviços',
      description: 'Calibração anual com certificado',
      condition: 'Serviço',
      price_cash: 250,
      price_term: 280,
      is_active: true,
    });
    expect(valid.success).toBe(true);

    const invalidNegative = priceCatalogItemSchema.safeParse({
      code: 'SRV-001',
      category: 'Serviços',
      description: 'Serviço teste',
      condition: 'Serviço',
      price_cash: -10,
      price_term: 200,
    });
    expect(invalidNegative.success).toBe(false);
  });

  it('2. Preserva integralmente os 130 itens oficiais existentes na EA Balanças', async () => {
    const rows = await runAsUser<{ count: string }>(USER_GESTOR_A, `
      SELECT count(*) as count FROM public.price_catalog_items WHERE company_id = '${companyAId}';
    `);
    expect(Number(rows[0].count)).toBe(130);
  });

  it('3. Gestor cadastra novo serviço/peça no catálogo com registro automático no histórico', async () => {
    const inserted = await runAsUser<{ id: string; code: string; price_cash: string; price_term: string }>(USER_GESTOR_A, `
      INSERT INTO public.price_catalog_items (
        company_id, code, category, subcategory, description, condition, price_cash, price_term, is_active, created_by
      ) VALUES (
        '${companyAId}', 'SRV-001', 'Serviços Técnicos', 'Aferição', 'Calibração com Pesos Padrão 30kg', 'Serviço', 250.00, 290.00, true, '${USER_GESTOR_A}'
      ) RETURNING id, code, price_cash, price_term;
    `);
    newItemId = inserted[0].id;
    expect(inserted[0].code).toBe('SRV-001');
    expect(Number(inserted[0].price_cash)).toBe(250);
    expect(Number(inserted[0].price_term)).toBe(290);

    // Auditoria automática
    const hist = await runAsUser<{ event_type: string; new_price_cash: string }>(USER_GESTOR_A, `
      SELECT event_type, new_price_cash FROM public.price_catalog_history WHERE catalog_item_id = '${newItemId}';
    `);
    expect(hist).toHaveLength(1);
    expect(hist[0].event_type).toBe('created');
    expect(Number(hist[0].new_price_cash)).toBe(250);
  });

  it('4. Técnico NÃO pode cadastrar, editar ou desativar itens do catálogo nem acessar auditoria de preços', async () => {
    await expect(
      runAsUser(USER_TECNICO_A, `
        INSERT INTO public.price_catalog_items (company_id, code, category, description, condition, price_cash, price_term)
        VALUES ('${companyAId}', 'HAC-001', 'Teste', 'Item não autorizado', 'Nova', 1.00, 1.00);
      `)
    ).rejects.toThrow();

    const updByTech = await runAsUser(USER_TECNICO_A, `
      UPDATE public.price_catalog_items SET price_cash = 1.00 WHERE id = '${cat001Id}' RETURNING id;
    `);
    expect(updByTech).toHaveLength(0);

    const histByTech = await runAsUser(USER_TECNICO_A, `
      SELECT * FROM public.price_catalog_history WHERE company_id = '${companyAId}';
    `);
    expect(histByTech).toHaveLength(0);
  });

  it('5. Isolamento multiempresa: Gestor de outra empresa NÃO vê nem altera catálogo ou histórico da EA Balanças', async () => {
    const readByB = await runAsUser(USER_GESTOR_B, `
      SELECT * FROM public.price_catalog_items WHERE company_id = '${companyAId}';
    `);
    expect(readByB).toHaveLength(0);

    const updByB = await runAsUser(USER_GESTOR_B, `
      UPDATE public.price_catalog_items SET price_cash = 9999.00 WHERE id = '${cat001Id}' RETURNING id;
    `);
    expect(updByB).toHaveLength(0);

    const histByB = await runAsUser(USER_GESTOR_B, `
      SELECT * FROM public.price_catalog_history WHERE company_id = '${companyAId}';
    `);
    expect(histByB).toHaveLength(0);
  });

  it('6. Reajuste de preço no catálogo NÃO altera valores históricos de OS já autorizada, mas atualiza novos orçamentos e registra auditoria', async () => {
    // 6.1 Técnico propõe CAT-001 (370.51 à vista) e Gestor autoriza na OS
    const proposed = await runAsUser<{ id: string; unit_price: string }>(USER_TECNICO_A, `
      INSERT INTO public.service_order_items (
        service_order_id, catalog_item_id, item_code, description, payment_modality, quantity
      ) VALUES (
        '${osAId}', '${cat001Id}', 'CAT-001', 'Teclado Prix5 plus/prix4 flex', 'cash', 1
      ) RETURNING id, unit_price;
    `);
    const osItemId = proposed[0].id;
    expect(Number(proposed[0].unit_price)).toBe(370.51);

    await runAsUser(USER_GESTOR_A, `
      UPDATE public.service_order_items SET item_status = 'authorized' WHERE id = '${osItemId}';
    `);

    // 6.2 Gestor edita preço oficial do CAT-001 no catálogo (370.51 -> 420.00 à vista)
    await runAsUser(USER_GESTOR_A, `
      UPDATE public.price_catalog_items
         SET price_cash = 420.00,
             price_term = 450.00
       WHERE id = '${cat001Id}';
    `);

    // 6.3 Verifica que o histórico de auditoria do catálogo registrou o reajuste
    const hist = await runAsUser<{ event_type: string; old_price_cash: string; new_price_cash: string }>(USER_GESTOR_A, `
      SELECT event_type, old_price_cash, new_price_cash
        FROM public.price_catalog_history
       WHERE catalog_item_id = '${cat001Id}'
       ORDER BY created_at DESC;
    `);
    expect(hist).toHaveLength(1);
    expect(hist[0].event_type).toBe('price_updated');
    expect(Number(hist[0].old_price_cash)).toBe(370.51);
    expect(Number(hist[0].new_price_cash)).toBe(420);

    // 6.4 Verifica que o item já autorizado na OS PRESERVOU integralmente R$ 370.51
    const osItemAfter = await runAsUser<{ unit_price: string; total_price: string }>(USER_GESTOR_A, `
      SELECT unit_price, total_price FROM public.service_order_items WHERE id = '${osItemId}';
    `);
    expect(Number(osItemAfter[0].unit_price)).toBe(370.51);
    expect(Number(osItemAfter[0].total_price)).toBe(370.51);

    // 6.5 Novo orçamento na OS já utiliza o novo preço oficial R$ 420.00
    const newProposal = await runAsUser<{ unit_price: string }>(USER_TECNICO_A, `
      INSERT INTO public.service_order_items (
        service_order_id, catalog_item_id, item_code, description, payment_modality, quantity
      ) VALUES (
        '${osAId}', '${cat001Id}', 'CAT-001', 'Teclado Prix5 plus/prix4 flex', 'cash', 1
      ) RETURNING unit_price;
    `);
    expect(Number(newProposal[0].unit_price)).toBe(420);
  });

  it('7. Gestor desativa e reativa item com auditoria registrada e log imutável', async () => {
    await runAsUser(USER_GESTOR_A, `
      UPDATE public.price_catalog_items SET is_active = false WHERE id = '${newItemId}';
    `);
    await runAsUser(USER_GESTOR_A, `
      UPDATE public.price_catalog_items SET is_active = true WHERE id = '${newItemId}';
    `);

    const hist = await runAsUser<{ event_type: string }>(USER_GESTOR_A, `
      SELECT event_type FROM public.price_catalog_history
       WHERE catalog_item_id = '${newItemId}'
       ORDER BY created_at ASC;
    `);
    expect(hist.map((h) => h.event_type)).toEqual(['created', 'deactivated', 'activated']);

    // Gestor também não pode falsificar ou apagar registros do histórico
    await expect(
      runAsUser(USER_GESTOR_A, `DELETE FROM public.price_catalog_history WHERE catalog_item_id = '${newItemId}';`)
    ).rejects.toThrow();
  });
});
