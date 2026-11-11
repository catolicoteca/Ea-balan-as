import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getChecklistProgress,
  getGoogleMapsLink,
  parseExecutionMetadata,
  SCALE_CHECKLIST_ITEMS,
  serializeExecutionMetadata,
} from '../src/lib/fieldExecution';

describe('ETAPA 2 — Deslocamento, Check-in GPS, Diagnóstico e Checklist Técnico de Balanças', () => {
  let db: PGlite;

  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_TECNICO_A = '22222222-2222-4222-8222-222222222222';
  const USER_TECNICO_OUTRO = '33333333-3333-4333-8333-333333333333';
  const USER_GESTOR_B = '44444444-4444-4444-8444-444444444444';

  let companyAId = '';
  let companyBId = '';
  let clientAId = '';
  let unitAId = '';
  let equipAId = '';
  let techAId = '';
  let techOutroId = '';
  let techSemOsId = '';
  let osAId = '';

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
    await db.exec(readFileSync(resolve('supabase/migrations/005_technician_invitation_system.sql'), 'utf-8'));

    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, phone, email, sidebar_color)
      VALUES ('Concorrente Balanças', 'Concorrente Ltda', 'concorrente-balancas', '88.777.666/0001-55', '(11) 3000-0000', 'contato@concorrente.com.br', '#0B2545')
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br'),
        ('${USER_TECNICO_A}', 'tecnico.a@eabalancas.com.br'),
        ('${USER_TECNICO_OUTRO}', 'tecnico.outro@eabalancas.com.br'),
        ('${USER_GESTOR_B}', 'gestor@concorrente.com.br');

      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', true),
        ('${companyAId}', '${USER_TECNICO_A}', 'technician', true),
        ('${companyAId}', '${USER_TECNICO_OUTRO}', 'technician', true),
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', true);
    `);

    // Técnicos na Empresa A
    const tA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyAId}', '${USER_TECNICO_A}', 'Técnico Campo A', 'tecnico.a@eabalancas.com.br', true)
      RETURNING id;
    `);
    techAId = tA[0].id;

    const tOutro = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyAId}', '${USER_TECNICO_OUTRO}', 'Técnico Não Atribuído', 'tecnico.outro@eabalancas.com.br', true)
      RETURNING id;
    `);
    techOutroId = tOutro[0].id;

    const tSemOs = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, full_name, email, is_active)
      VALUES ('${companyAId}', 'Técnico Teste Descartável', 'descartavel@eabalancas.com.br', true)
      RETURNING id;
    `);
    techSemOsId = tSemOs[0].id;

    // Cliente, Unidade, Equipamento e OS para Técnico A
    const cA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.clients (company_id, name, trade_name, document_type, document_number)
      VALUES ('${companyAId}', 'Frigorífico Central Ltda', 'Frigorífico Central', 'CNPJ', '22.333.444/0001-55')
      RETURNING id;
    `);
    clientAId = cA[0].id;

    const uA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.client_units (company_id, client_id, unit_name, street, city, state)
      VALUES ('${companyAId}', '${clientAId}', 'Matriz', 'Av. Brasil, 500', 'Campinas', 'SP')
      RETURNING id;
    `);
    unitAId = uA[0].id;

    const eA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.equipments (company_id, client_id, unit_id, brand, model, serial_number)
      VALUES ('${companyAId}', '${clientAId}', '${unitAId}', 'Toledo', 'Prix 5 Plus', 'SN-998877')
      RETURNING id;
    `);
    equipAId = eA[0].id;

    const osRes = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.service_orders (
        company_id, sequence_number, order_number, client_id, unit_id, equipment_id,
        primary_technician_id, title, reported_issue, status, priority, created_by
      ) VALUES (
        '${companyAId}', 20, 'OS-2026-0020', '${clientAId}', '${unitAId}', '${equipAId}',
        '${techAId}', 'Calibração e Reparo de Célula', 'Balança oscilando 20g no prato',
        'scheduled', 'high', '${USER_GESTOR_A}'
      ) RETURNING id;
    `);
    osAId = osRes[0].id;
  });

  it('1. Helper de Checklist e GPS valida todos os 8 pontos metrológicos e gera links de mapa corretamente', () => {
    expect(SCALE_CHECKLIST_ITEMS).toHaveLength(8);

    const parsed = parseExecutionMetadata(null);
    expect(parsed.travel_started_at).toBeNull();
    expect(parsed.arrived_at).toBeNull();

    const emptyProg = getChecklistProgress(parsed.checklist);
    expect(emptyProg.answered).toBe(0);
    expect(emptyProg.percentage).toBe(0);
    expect(emptyProg.isComplete).toBe(false);

    parsed.checklist.power_and_cables = 'ok';
    parsed.checklist.load_cell_and_wiring = 'fail';
    parsed.checklist.display_and_keyboard = 'attention';
    const partialProg = getChecklistProgress(parsed.checklist);
    expect(partialProg.answered).toBe(3);
    expect(partialProg.issuesCount).toBe(2);
    expect(partialProg.isComplete).toBe(false);

    const mapsUrl = getGoogleMapsLink(-22.90556, -47.06083);
    expect(mapsUrl).toBe('https://www.google.com/maps?q=-22.90556,-47.06083');
  });

  it('2. Técnico atribuído inicia deslocamento, altera OS para in_progress e registra histórico', async () => {
    const travelStartedAt = new Date().toISOString();
    const meta = serializeExecutionMetadata({
      ...parseExecutionMetadata(null),
      travel_started_at: travelStartedAt,
      travel_latitude: -22.9,
      travel_longitude: -47.05,
    });

    const exec = await runAsUser<{ id: string }>(USER_TECNICO_A, `
      INSERT INTO public.service_order_executions (
        company_id, service_order_id, technician_id, started_at, calibration_measurements
      ) VALUES (
        '${companyAId}', '${osAId}', '${techAId}', '${travelStartedAt}', $1::jsonb
      ) RETURNING id;
    `, [JSON.stringify(meta)]);

    expect(exec[0].id).toBeTruthy();

    // Promove status da OS para 'in_progress' e grava histórico
    await runAsUser(USER_TECNICO_A, `
      UPDATE public.service_orders SET status = 'in_progress', started_at = '${travelStartedAt}' WHERE id = '${osAId}';
    `);

    await runAsUser(USER_TECNICO_A, `
      INSERT INTO public.service_order_history (
        company_id, service_order_id, actor_user_id, event_type, old_status, new_status, description
      ) VALUES (
        '${companyAId}', '${osAId}', '${USER_TECNICO_A}', 'travel_started', 'scheduled', 'in_progress', 'Técnico iniciou deslocamento.'
      );
    `);

    const osAfter = await runAsUser<{ status: string }>(USER_GESTOR_A, `
      SELECT status FROM public.service_orders WHERE id = '${osAId}';
    `);
    expect(osAfter[0].status).toBe('in_progress');
  });

  it('3. Técnico registra chegada no cliente com horário + coordenadas GPS e preenche checklist + diagnóstico', async () => {
    const arrivedAt = new Date().toISOString();
    const meta = serializeExecutionMetadata({
      travel_started_at: arrivedAt,
      travel_latitude: -22.9,
      travel_longitude: -47.05,
      arrived_at: arrivedAt,
      checkin_accuracy_meters: 12,
      gps_fallback_reason: null,
      checklist: {
        power_and_cables: 'ok',
        load_cell_and_wiring: 'fail',
        display_and_keyboard: 'ok',
        leveling_and_feet: 'ok',
        platform_and_structure: 'ok',
        inmetro_seal_integrity: 'ok',
        zero_stability_and_tare: 'attention',
        linearity_and_eccentricity: 'ok',
      },
      checklist_notes: 'Oxidação na caixa de junção corrigida.',
    });

    const updated = await runAsUser<{
      checkin_latitude: string;
      checkin_longitude: string;
      diagnosis: string;
      removed_seal_number: string;
      applied_seal_number: string;
      equipment_approved: boolean;
    }>(USER_TECNICO_A, `
      UPDATE public.service_order_executions
         SET checkin_latitude = -22.90556,
             checkin_longitude = -47.06083,
             diagnosis = 'Cabo da célula de carga com oxidação intermitente.',
             performed_services = 'Limpeza química, ressoldagem e calibração com pesos padrão M1.',
             removed_seal_number = 'SP-112233',
             applied_seal_number = 'SP-998877',
             equipment_approved = true,
             calibration_measurements = $1::jsonb
       WHERE service_order_id = '${osAId}'
       RETURNING checkin_latitude, checkin_longitude, diagnosis, removed_seal_number, applied_seal_number, equipment_approved;
    `, [JSON.stringify(meta)]);

    expect(Number(updated[0].checkin_latitude)).toBeCloseTo(-22.90556, 4);
    expect(Number(updated[0].checkin_longitude)).toBeCloseTo(-47.06083, 4);
    expect(updated[0].diagnosis).toContain('oxidação');
    expect(updated[0].removed_seal_number).toBe('SP-112233');
    expect(updated[0].applied_seal_number).toBe('SP-998877');
    expect(updated[0].equipment_approved).toBe(true);
  });

  it('4. Gestor acompanha em tempo real os dados de campo salvos pelo técnico (GPS, checklist e lacres)', async () => {
    const viewByMgr = await runAsUser<{
      checkin_latitude: string;
      diagnosis: string;
      calibration_measurements: { checklist: Record<string, string>; arrived_at: string };
    }>(USER_GESTOR_A, `
      SELECT checkin_latitude, diagnosis, calibration_measurements
        FROM public.service_order_executions
       WHERE service_order_id = '${osAId}';
    `);

    expect(viewByMgr).toHaveLength(1);
    expect(viewByMgr[0].diagnosis).toContain('Cabo da célula');
    expect(viewByMgr[0].calibration_measurements.arrived_at).toBeTruthy();
    expect(viewByMgr[0].calibration_measurements.checklist.load_cell_and_wiring).toBe('fail');
  });

  it('5. Segurança RLS: Técnico não atribuído e Gestor de outra empresa são BLOQUEADOS ao tentar ler ou alterar a execução', async () => {
    // Outro técnico da mesma empresa sem atribuição à OS vê 0 registros
    const readByOutroTech = await runAsUser(USER_TECNICO_OUTRO, `
      SELECT * FROM public.service_order_executions WHERE service_order_id = '${osAId}';
    `);
    expect(readByOutroTech).toHaveLength(0);

    // Tentativa de injetar execução em OS não atribuída é rejeitada pelo RLS
    await expect(
      runAsUser(USER_TECNICO_OUTRO, `
        INSERT INTO public.service_order_executions (company_id, service_order_id, technician_id, diagnosis)
        VALUES ('${companyAId}', '${osAId}', '${techOutroId}', 'Invasão');
      `)
    ).rejects.toThrow();

    // Gestor de empresa B não vê nada da Empresa A
    const readByEmpresaB = await runAsUser(USER_GESTOR_B, `
      SELECT * FROM public.service_order_executions WHERE service_order_id = '${osAId}';
    `);
    expect(readByEmpresaB).toHaveLength(0);
  });

  it('6. Integridade referencial: Banco BLOQUEIA exclusão de técnico com histórico de execução (23503), mas permite excluir técnico sem OS', async () => {
    // Técnico A possui execução vinculada em service_order_executions -> FK RESTRICT impede exclusão
    await expect(
      runAsUser(USER_GESTOR_A, `DELETE FROM public.technicians WHERE id = '${techAId}';`)
    ).rejects.toThrow();

    // Técnico sem OS vinculada pode ser excluído normalmente pelo Gestor
    const delRes = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      DELETE FROM public.technicians WHERE id = '${techSemOsId}' RETURNING id;
    `);
    expect(delRes).toHaveLength(1);
  });
});
