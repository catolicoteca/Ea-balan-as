import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCatalogItemPricing } from '../src/lib/catalogPricing';
import { companyDiscountsSchema, priceCatalogItemSchema } from '../src/lib/validation';

describe('Descontos Configuráveis por Modalidade de Pagamento e Exceção por Item', () => {
  it('1. resolveCatalogItemPricing calcula padrão da empresa vs exceção por item sem alterar preço-base', () => {
    const standardCash = resolveCatalogItemPricing({
      baseCash: 1000,
      baseTerm: 1200,
      companyDiscountCash: 5,
      companyDiscountTerm: 10,
      modality: 'cash',
    });
    expect(standardCash).toEqual({
      basePrice: 1000,
      discountPercent: 5,
      discountSource: 'company',
      finalUnitPrice: 950,
      discountAmountPerUnit: 50,
      lineTotal: 950,
      lineDiscountTotal: 50,
    });

    const exceptionTerm = resolveCatalogItemPricing({
      baseCash: 1000,
      baseTerm: 1200,
      itemDiscountTerm: 15,
      companyDiscountCash: 5,
      companyDiscountTerm: 10,
      modality: 'term',
      quantity: 2,
    });
    expect(exceptionTerm).toEqual({
      basePrice: 1200,
      discountPercent: 15,
      discountSource: 'item',
      finalUnitPrice: 1020,
      discountAmountPerUnit: 180,
      lineTotal: 2040,
      lineDiscountTotal: 360,
    });

    // Exceção explícita de 0% desativa o desconto padrão apenas neste item
    const zeroOverride = resolveCatalogItemPricing({
      baseCash: 500,
      baseTerm: 550,
      itemDiscountCash: 0,
      companyDiscountCash: 8,
      modality: 'cash',
    });
    expect(zeroOverride.discountPercent).toBe(0);
    expect(zeroOverride.discountSource).toBe('none');
    expect(zeroOverride.finalUnitPrice).toBe(500);
  });

  it('2. Schemas Zod validam limites de 0% a 100% e exceções opcionais nulas', () => {
    expect(
      companyDiscountsSchema.safeParse({
        discount_cash_percent: 5.5,
        discount_term_percent: 12,
      }).success
    ).toBe(true);

    expect(
      companyDiscountsSchema.safeParse({
        discount_cash_percent: 105,
        discount_term_percent: 0,
      }).success
    ).toBe(false);

    const parsedEmptyOverride = priceCatalogItemSchema.safeParse({
      code: 'CAT-999',
      category: 'Serviços',
      description: 'Ajuste metrológico',
      condition: 'Serviço',
      price_cash: 300,
      price_term: 350,
      discount_cash_percent: '',
      discount_term_percent: 10,
      is_active: true,
    });
    expect(parsedEmptyOverride.success).toBe(true);
    if (parsedEmptyOverride.success) {
      expect(parsedEmptyOverride.data.discount_cash_percent).toBeNull();
      expect(parsedEmptyOverride.data.discount_term_percent).toBe(10);
    }
  });
});

describe('Persistência, Segurança PostgreSQL e Imutabilidade Histórica de Descontos (PGlite)', () => {
  let db: PGlite;

  const USER_GESTOR = 'aaaaaaaa-1111-4111-8111-111111111111';
  const USER_TECNICO = 'bbbbbbbb-2222-4222-8222-222222222222';

  let companyId = '';
  let techId = '';
  let osId = '';
  let cat001Id = '';
  let cat002Id = '';
  let authorizedItemId = '';

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

    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));

    const comp = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyId = comp.rows[0].id;

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_GESTOR}', 'gestor@eabalancas.com.br'),
        ('${USER_TECNICO}', 'tecnico@eabalancas.com.br');

      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES
        ('${companyId}', '${USER_GESTOR}', 'manager', true),
        ('${companyId}', '${USER_TECNICO}', 'technician', true);
    `);

    const tRes = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyId}', '${USER_TECNICO}', 'Técnico Campo', 'tecnico@eabalancas.com.br', true)
      RETURNING id;
    `);
    techId = tRes[0].id;

    const cRes = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.clients (company_id, name, trade_name, document_type, document_number)
      VALUES ('${companyId}', 'Mercado Central', 'Mercado Central', 'CNPJ', '22.333.444/0001-99')
      RETURNING id;
    `);
    const uRes = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.client_units (company_id, client_id, unit_name, street, city, state)
      VALUES ('${companyId}', '${cRes[0].id}', 'Loja 1', 'Rua A, 100', 'São Paulo', 'SP')
      RETURNING id;
    `);
    const eRes = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.equipments (company_id, client_id, unit_id, brand, model, serial_number)
      VALUES ('${companyId}', '${cRes[0].id}', '${uRes[0].id}', 'Toledo', 'Prix 4', 'SN-DISC-01')
      RETURNING id;
    `);

    const osRes = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.service_orders (
        company_id, sequence_number, order_number, client_id, unit_id, equipment_id,
        primary_technician_id, title, reported_issue, status, priority, created_by
      ) VALUES (
        '${companyId}', 88, 'OS-2026-0088', '${cRes[0].id}', '${uRes[0].id}', '${eRes[0].id}',
        '${techId}', 'Manutenção Prix 4', 'Display apagado', 'in_progress', 'high', '${USER_GESTOR}'
      ) RETURNING id;
    `);
    osId = osRes[0].id;

    const catRows = await runAsUser<{ id: string; code: string }>(USER_GESTOR, `
      SELECT id, code FROM public.price_catalog_items
      WHERE company_id = '${companyId}' AND code IN ('CAT-001', 'CAT-002')
      ORDER BY code;
    `);
    cat001Id = catRows[0].id;
    cat002Id = catRows[1].id;

    // Simula OS pré-existentes no banco remoto (proposed, authorized, applied) ANTES de aplicar 006 e 007
    await runAsUser(USER_GESTOR, `
      INSERT INTO public.service_order_items (
        company_id, service_order_id, catalog_item_id, item_code, description, condition,
        payment_modality, quantity, unit_price, discount_amount, total_price, item_status
      ) VALUES
        ('${companyId}', '${osId}', '${cat001Id}', 'CAT-001', 'Legado Aplicado', 'Nova', 'cash', 1, 370.51, 0.00, 370.51, 'applied'),
        ('${companyId}', '${osId}', '${cat001Id}', 'CAT-001', 'Legado Autorizado', 'Nova', 'cash', 2, 370.51, 10.00, 731.02, 'authorized');
    `);

    await db.exec(readFileSync(resolve('supabase/migrations/006_price_catalog_audit.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/007_catalog_configurable_discounts.sql'), 'utf-8'));
  });

  it('3. Todos os 130 itens originais são preservados após a migração 007', async () => {
    const res = await runAsUser<{ total: string }>(USER_TECNICO, `
      SELECT count(*)::text AS total FROM public.price_catalog_items WHERE company_id = '${companyId}';
    `);
    expect(Number(res[0].total)).toBe(130);
  });

  it('4. Técnico NÃO pode alterar descontos globais da empresa nem exceções de itens (RLS)', async () => {
    const compUpd = await runAsUser<{ id: string }>(USER_TECNICO, `
      UPDATE public.companies SET discount_cash_percent = 50 WHERE id = '${companyId}' RETURNING id;
    `);
    expect(compUpd.length).toBe(0);

    const catUpd = await runAsUser<{ id: string }>(USER_TECNICO, `
      UPDATE public.price_catalog_items SET discount_cash_percent = 90 WHERE id = '${cat001Id}' RETURNING id;
    `);
    expect(catUpd.length).toBe(0);

    const compState = await runAsUser<{ discount_cash_percent: string }>(USER_TECNICO, `
      SELECT discount_cash_percent::text FROM public.companies WHERE id = '${companyId}';
    `);
    expect(Number(compState[0].discount_cash_percent)).toBe(0);
  });

  it('5. Gestor configura descontos globais (5% à vista, 10% prazo) + exceção no CAT-001 (15% à vista) preservando preços-base', async () => {
    const beforeCat001 = await runAsUser<{ price_cash: string; price_term: string }>(USER_GESTOR, `
      SELECT price_cash::text, price_term::text FROM public.price_catalog_items WHERE id = '${cat001Id}';
    `);

    await runAsUser(USER_GESTOR, `
      UPDATE public.companies
      SET discount_cash_percent = 5.00, discount_term_percent = 10.00
      WHERE id = '${companyId}';
    `);

    await runAsUser(USER_GESTOR, `
      UPDATE public.price_catalog_items
      SET discount_cash_percent = 15.00
      WHERE id = '${cat001Id}';
    `);

    const afterCat001 = await runAsUser<{
      price_cash: string;
      price_term: string;
      discount_cash_percent: string;
    }>(USER_TECNICO, `
      SELECT price_cash::text, price_term::text, discount_cash_percent::text
      FROM public.price_catalog_items WHERE id = '${cat001Id}';
    `);

    // Preço-base preservado integralmente
    expect(afterCat001[0].price_cash).toBe(beforeCat001[0].price_cash);
    expect(afterCat001[0].price_term).toBe(beforeCat001[0].price_term);
    expect(Number(afterCat001[0].discount_cash_percent)).toBe(15);

    // Auditoria registrou atualização da exceção no catálogo
    const hist = await runAsUser<{ event_type: string; new_disc: string }>(
      USER_GESTOR,
      `
      SELECT event_type, changes->'discount_cash_percent'->>'new' AS new_disc
      FROM public.price_catalog_history
      WHERE catalog_item_id = '${cat001Id}'
      ORDER BY created_at DESC
      LIMIT 1;
    `
    );
    expect(hist.length).toBe(1);
    expect(hist[0].event_type).toBe('price_updated');
    expect(Number(hist[0].new_disc)).toBe(15);
  });

  it('6. Trigger no PostgreSQL sobrescreve tentativa de fraude de preço/desconto do técnico na OS e aplica o desconto autorizado', async () => {
    // Técnico tenta inserir CAT-001 (370.51 à vista, exceção 15% => 314.93) fraudando desconto=99% e unit_price=1.00
    const insertedCat001 = await runAsUser<{
      id: string;
      base_unit_price: string;
      discount_percent: string;
      unit_price: string;
      discount_amount: string;
      total_price: string;
    }>(USER_TECNICO, `
      INSERT INTO public.service_order_items (
        company_id, service_order_id, catalog_item_id, item_code, description, condition,
        payment_modality, quantity, base_unit_price, discount_percent, unit_price, discount_amount, total_price, item_status
      ) VALUES (
        '${companyId}', '${osId}', '${cat001Id}', 'CAT-001', 'Bateria adulterada', 'Nova',
        'cash', 2, 10.00, 99.00, 1.00, 999.00, 2.00, 'proposed'
      )
      RETURNING id, base_unit_price::text, discount_percent::text, unit_price::text, discount_amount::text, total_price::text;
    `);

    authorizedItemId = insertedCat001[0].id;
    expect(Number(insertedCat001[0].base_unit_price)).toBe(370.51);
    expect(Number(insertedCat001[0].discount_percent)).toBe(15);
    expect(Number(insertedCat001[0].unit_price)).toBe(314.93);
    expect(Number(insertedCat001[0].discount_amount)).toBe(111.16);
    expect(Number(insertedCat001[0].total_price)).toBe(629.86);

    // Técnico insere CAT-002 na modalidade 'term' (sem exceção por item -> herda 10% global da empresa)
    const cat002PriceRow = await runAsUser<{ price_term: string }>(USER_TECNICO, `
      SELECT price_term::text FROM public.price_catalog_items WHERE id = '${cat002Id}';
    `);
    const baseTerm = Number(cat002PriceRow[0].price_term);
    const expectedFinalTerm = Math.round(baseTerm * 0.9 * 100) / 100;

    const insertedCat002 = await runAsUser<{
      base_unit_price: string;
      discount_percent: string;
      unit_price: string;
    }>(USER_TECNICO, `
      INSERT INTO public.service_order_items (
        company_id, service_order_id, catalog_item_id, item_code, description, condition,
        payment_modality, quantity, unit_price, total_price, item_status
      ) VALUES (
        '${companyId}', '${osId}', '${cat002Id}', 'CAT-002', 'Teste prazo', 'Nova',
        'term', 1, 1.00, 1.00, 'proposed'
      )
      RETURNING base_unit_price::text, discount_percent::text, unit_price::text;
    `);

    expect(Number(insertedCat002[0].base_unit_price)).toBe(baseTerm);
    expect(Number(insertedCat002[0].discount_percent)).toBe(10);
    expect(Number(insertedCat002[0].unit_price)).toBe(expectedFinalTerm);
  });

  it('7. Alterações futuras de descontos ou preços não afetam OS já autorizada/concluída', async () => {
    // Gestor autoriza o item proposto na OS
    await runAsUser(USER_GESTOR, `
      UPDATE public.service_order_items
      SET item_status = 'authorized'
      WHERE id = '${authorizedItemId}';
    `);

    // Gestor muda o desconto padrão da empresa e altera preço e exceção do CAT-001 no catálogo
    await runAsUser(USER_GESTOR, `
      UPDATE public.companies SET discount_cash_percent = 30.00 WHERE id = '${companyId}';
    `);
    await runAsUser(USER_GESTOR, `
      UPDATE public.price_catalog_items
      SET price_cash = 999.99, discount_cash_percent = 40.00
      WHERE id = '${cat001Id}';
    `);

    // A OS já autorizada preserva integralmente preço-base, percentual de desconto e valor final históricos
    const osItemAfter = await runAsUser<{
      base_unit_price: string;
      discount_percent: string;
      unit_price: string;
      total_price: string;
      item_status: string;
    }>(USER_GESTOR, `
      SELECT base_unit_price::text, discount_percent::text, unit_price::text, total_price::text, item_status
      FROM public.service_order_items
      WHERE id = '${authorizedItemId}';
    `);

    expect(osItemAfter[0].item_status).toBe('authorized');
    expect(Number(osItemAfter[0].base_unit_price)).toBe(370.51);
    expect(Number(osItemAfter[0].discount_percent)).toBe(15);
    expect(Number(osItemAfter[0].unit_price)).toBe(314.93);
    expect(Number(osItemAfter[0].total_price)).toBe(629.86);

    // Itens legados pré-existentes antes das migrações 006/007 preservam seus valores intactos
    const legacyAfter = await runAsUser<{
      description: string;
      base_unit_price: string;
      discount_amount: string;
      total_price: string;
    }>(USER_GESTOR, `
      SELECT description, base_unit_price::text, discount_amount::text, total_price::text
      FROM public.service_order_items
      WHERE service_order_id = '${osId}' AND description LIKE 'Legado%'
      ORDER BY description;
    `);
    expect(legacyAfter).toHaveLength(2);
    expect(Number(legacyAfter[0].base_unit_price)).toBe(370.51);
    expect(Number(legacyAfter[0].total_price)).toBe(370.51);
    expect(Number(legacyAfter[1].discount_amount)).toBe(10.00);
    expect(Number(legacyAfter[1].total_price)).toBe(731.02);
  });

  it('8. Rollback completo da 007 e 006 restaura triggers anteriores (003/006) SEM apagar dados históricos ou os 130 itens', async () => {
    // Executa rollback da 007 mantendo colunas/dados históricos intactos
    await db.exec(readFileSync(resolve('supabase/migrations/007_rollback_catalog_configurable_discounts.sql'), 'utf-8'));

    // 1) Verifica que a trigger voltou ao comportamento original da 003 (técnico recebe preço cheio do catálogo, desconto = 0)
    const after007Rollback = await runAsUser<{
      unit_price: string;
      discount_amount: string;
      total_price: string;
    }>(USER_TECNICO, `
      INSERT INTO public.service_order_items (
        company_id, service_order_id, catalog_item_id, item_code, description, condition,
        payment_modality, quantity, unit_price, total_price, item_status
      ) VALUES (
        '${companyId}', '${osId}', '${cat002Id}', 'CAT-002', 'Teste após rollback 007', 'Nova',
        'term', 1, 1.00, 1.00, 'proposed'
      )
      RETURNING unit_price::text, discount_amount::text, total_price::text;
    `);
    const cat002Row = await runAsUser<{ price_term: string }>(USER_TECNICO, `
      SELECT price_term::text FROM public.price_catalog_items WHERE id = '${cat002Id}';
    `);
    expect(Number(after007Rollback[0].unit_price)).toBe(Number(cat002Row[0].price_term));
    expect(Number(after007Rollback[0].discount_amount)).toBe(0);

    // 2) Dados históricos gravados na OS autorizada e histórico do catálogo permanecem 100% preservados
    const preservedAuth = await runAsUser<{ base_unit_price: string; discount_percent: string; total_price: string }>(
      USER_GESTOR,
      `SELECT base_unit_price::text, discount_percent::text, total_price::text FROM public.service_order_items WHERE id = '${authorizedItemId}';`
    );
    expect(Number(preservedAuth[0].base_unit_price)).toBe(370.51);
    expect(Number(preservedAuth[0].discount_percent)).toBe(15);
    expect(Number(preservedAuth[0].total_price)).toBe(629.86);

    // 3) Executa rollback da 006 e confirma que price_catalog_history foi preservada e auditoria parou de gravar novos eventos
    const histCountBefore = await runAsUser<{ total: string }>(USER_GESTOR, `
      SELECT count(*)::text AS total FROM public.price_catalog_history WHERE company_id = '${companyId}';
    `);
    expect(Number(histCountBefore[0].total)).toBeGreaterThanOrEqual(1);

    await db.exec(readFileSync(resolve('supabase/migrations/006_rollback_price_catalog_audit.sql'), 'utf-8'));

    const histCountAfter = await runAsUser<{ total: string }>(USER_GESTOR, `
      SELECT count(*)::text AS total FROM public.price_catalog_history WHERE company_id = '${companyId}';
    `);
    expect(Number(histCountAfter[0].total)).toBe(Number(histCountBefore[0].total));

    // Os 130 itens do catálogo seguem intactos
    const itemsAfterRollback = await runAsUser<{ total: string }>(USER_TECNICO, `
      SELECT count(*)::text AS total FROM public.price_catalog_items WHERE company_id = '${companyId}';
    `);
    expect(Number(itemsAfterRollback[0].total)).toBe(130);
  });
});
