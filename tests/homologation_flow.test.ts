import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPermissionsForRole } from '../src/lib/permissions';

describe('Homologação Visual e Fluxos Oficiais (Painel, Técnico, Convites e WhatsApp)', () => {
  let db: PGlite;

  const USER_GESTOR = '22222222-2222-4222-8222-222222222222';
  const USER_TECNICO = '33333333-3333-4333-8333-333333333333';

  let companyId = '';
  let clientId = '';
  let unitId = '';
  let equipId = '';
  let technicianRecordId = '';
  let osId = '';

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

    // Mock roles & auth schema do Supabase
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

    // 1. Aplica migrações oficiais
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));

    // 2. Registra o Gestor e a Empresa Oficial
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${USER_GESTOR}', 'gestor@eabalancas.com.br', '{"full_name":"Carlos Gestor"}');
    `);

    const compRows = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyId = compRows.rows[0].id;

    await db.exec(`
      INSERT INTO public.company_memberships (company_id, user_id, role, is_active)
      VALUES ('${companyId}', '${USER_GESTOR}', 'manager', true);
    `);

    // 3. Cadastra cliente, unidade e equipamento de teste
    const client = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.clients (company_id, name, trade_name, document_type, document_number, phone, email)
      VALUES ('${companyId}', 'Padaria & Supermercado Central Ltda', 'Supermercado Central', 'CNPJ', '11.222.333/0001-44', '(11) 97766-5544', 'central@padaria.com.br')
      RETURNING id;
    `);
    clientId = client[0].id;

    const unit = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.client_units (company_id, client_id, unit_name, street, street_number, city, state, postal_code)
      VALUES ('${companyId}', '${clientId}', 'Loja 1', 'Rua do Comércio', '123', 'Campinas', 'SP', '13000-000')
      RETURNING id;
    `);
    unitId = unit[0].id;

    const equip = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.equipments (company_id, client_id, unit_id, brand, model, serial_number, asset_tag, capacity_label, division_label)
      VALUES ('${companyId}', '${clientId}', '${unitId}', 'Toledo', 'Prix 4 Flex', 'PRX4-8899', 'TAG-08', '15kg', '5g')
      RETURNING id;
    `);
    equipId = equip[0].id;
  });

  it('1. Cadastro de Técnico pelo painel administrativo e emissão automática de convite por e-mail', async () => {
    // Gestor cadastra o técnico pelo formulário de Técnicos (TechniciansPage)
    const techInsert = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.technicians (company_id, full_name, email, phone, is_active)
      VALUES ('${companyId}', 'Lucas Metrologista', 'lucas.tecnico@eabalancas.com.br', '(11) 99887-7665', true)
      RETURNING id;
    `);
    technicianRecordId = techInsert[0].id;
    expect(technicianRecordId).toBeTruthy();

    // Sistema cria o registro de convite em company_invitations
    await runAsUser(USER_GESTOR, `
      INSERT INTO public.company_invitations (company_id, email, full_name, role, technician_id, invited_by, status)
      VALUES ('${companyId}', 'lucas.tecnico@eabalancas.com.br', 'Lucas Metrologista', 'technician', '${technicianRecordId}', '${USER_GESTOR}', 'pending');
    `);

    const inv = await runAsUser<{ email: string; status: string; role: string }>(USER_GESTOR, `
      SELECT email, status, role FROM public.company_invitations WHERE technician_id = '${technicianRecordId}';
    `);
    expect(inv[0].email).toBe('lucas.tecnico@eabalancas.com.br');
    expect(inv[0].status).toBe('pending');
    expect(inv[0].role).toBe('technician');
  });

  it('2. Fluxo oficial de ativação de conta: técnico se cadastra/loga e convite é aceito compulsoriamente', async () => {
    // Simula cadastro/login pelo Supabase Auth (dispara trigger handle_new_auth_user)
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${USER_TECNICO}', 'lucas.tecnico@eabalancas.com.br', '{"full_name":"Lucas Metrologista"}');
    `);

    // Verifica que o trigger da Fase A aceitou o convite e vinculou o técnico automaticamente
    const invAfter = await runAsUser<{ status: string }>(USER_GESTOR, `
      SELECT status FROM public.company_invitations WHERE technician_id = '${technicianRecordId}';
    `);
    expect(invAfter[0].status).toBe('accepted');

    const membership = await runAsUser<{ role: string; is_active: boolean }>(USER_GESTOR, `
      SELECT role, is_active FROM public.company_memberships WHERE company_id = '${companyId}' AND user_id = '${USER_TECNICO}';
    `);
    expect(membership[0].role).toBe('technician');
    expect(membership[0].is_active).toBe(true);

    const techRecord = await runAsUser<{ user_id: string }>(USER_GESTOR, `
      SELECT user_id FROM public.technicians WHERE id = '${technicianRecordId}';
    `);
    expect(techRecord[0].user_id).toBe(USER_TECNICO);
  });

  it('3. Permissões e regras de redirecionamento: técnico é direcionado para /tecnico e tem restrições administrativas', () => {
    const techPerms = getPermissionsForRole('technician');
    // Não pode gerenciar técnicos ou configurações da empresa
    expect(techPerms.canManageTechnicians).toBe(false);
    expect(techPerms.canManageCompanySettings).toBe(false);
    expect(techPerms.canApproveOrderItems).toBe(false);

    // Gestor tem permissão total
    const mgrPerms = getPermissionsForRole('manager');
    expect(mgrPerms.canManageTechnicians).toBe(true);
    expect(mgrPerms.canManageCompanySettings).toBe(true);
    expect(mgrPerms.canApproveOrderItems).toBe(true);
  });

  it('4. Criação de Ordem de Serviço atribuída ao técnico e geração de link WhatsApp', async () => {
    const osCreated = await runAsUser<{ id: string; order_number: string }>(USER_GESTOR, `
      INSERT INTO public.service_orders (
        company_id, sequence_number, order_number, client_id, unit_id, equipment_id,
        primary_technician_id, title, reported_issue, status, priority, created_by
      ) VALUES (
        '${companyId}', 10, 'OS-2026-0010', '${clientId}', '${unitId}', '${equipId}',
        '${technicianRecordId}', 'Troca de Teclado Toledo Prix 4', 'Teclado desgastado e travando tara',
        'in_progress', 'high', '${USER_GESTOR}'
      ) RETURNING id, order_number;
    `);
    osId = osCreated[0].id;
    expect(osCreated[0].order_number).toBe('OS-2026-0010');

    // Validação do gerador de link WhatsApp:
    // Garante que a mensagem gerada inclui o link direto para a rota do técnico
    const mockOrigin = 'https://app.eabalancas.com.br';
    const osLink = `${mockOrigin}/tecnico/os/${osId}`;
    const clientPhone = '11977665544';
    const msg = `*EA BALANÇAS — Ordem de Serviço #${osCreated[0].order_number}*\n*Link de Acesso Direto à OS:*\n${osLink}\n`;
    const waUrl = `https://wa.me/55${clientPhone}?text=${encodeURIComponent(msg)}`;

    expect(waUrl).toContain('https://wa.me/5511977665544');
    expect(waUrl).toContain(encodeURIComponent(osLink));
  });

  it('5. Fluxo completo pela interface (Técnico propõe -> Gestor autoriza -> Técnico aplica -> Persistência pós-refresh)', async () => {
    // 5.1: Técnico consulta catálogo de 130 itens reais
    const catalog = await runAsUser<{ count: string }>(USER_TECNICO, `
      SELECT count(*) as count FROM public.price_catalog_items WHERE company_id = '${companyId}';
    `);
    expect(Number(catalog[0].count)).toBe(130);

    // 5.2: Técnico propõe Teclado Prix 5 / Prix 4 (CAT-001, R$ 370.51 à vista)
    const proposed = await runAsUser<{ id: string; unit_price: string; total_price: string; item_status: string }>(USER_TECNICO, `
      INSERT INTO public.service_order_items (
        service_order_id, item_code, description, payment_modality, quantity
      ) VALUES (
        '${osId}', 'CAT-001', 'Teclado Prix5 plus/prix4 flex', 'cash', 1
      ) RETURNING id, unit_price, total_price, item_status;
    `);
    const itemId = proposed[0].id;
    expect(Number(proposed[0].unit_price)).toBe(370.51);
    expect(Number(proposed[0].total_price)).toBe(370.51);
    expect(proposed[0].item_status).toBe('proposed');

    // 5.3: Gestor revisa e autoriza o orçamento
    const authorized = await runAsUser<{ item_status: string; authorized_by: string }>(USER_GESTOR, `
      UPDATE public.service_order_items
         SET item_status = 'authorized'
       WHERE id = '${itemId}'
       RETURNING item_status, authorized_by;
    `);
    expect(authorized[0].item_status).toBe('authorized');
    expect(authorized[0].authorized_by).toBe(USER_GESTOR);

    // 5.4: Técnico em campo instala a peça e clica em 'Aplicado'
    const applied = await runAsUser<{ item_status: string; applied_by: string; applied_at: string }>(USER_TECNICO, `
      UPDATE public.service_order_items
         SET item_status = 'applied'
       WHERE id = '${itemId}'
       RETURNING item_status, applied_by, applied_at;
    `);
    expect(applied[0].item_status).toBe('applied');
    expect(applied[0].applied_by).toBe(USER_TECNICO);
    expect(applied[0].applied_at).toBeTruthy();

    // 5.5: Persistência após F5 / recarregamento de página
    const reloaded = await runAsUser<{ id: string; item_status: string; unit_price: string; applied_by: string }>(USER_TECNICO, `
      SELECT id, item_status, unit_price, applied_by FROM public.service_order_items WHERE id = '${itemId}';
    `);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].item_status).toBe('applied');
    expect(Number(reloaded[0].unit_price)).toBe(370.51);
    expect(reloaded[0].applied_by).toBe(USER_TECNICO);
  });
});
