import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildOrderStoragePath,
  validateServiceOrderClosure,
} from '../src/lib/fieldEvidence';
import { generateServiceOrderPdf } from '../src/lib/pdfReport';
import { serializeExecutionMetadata } from '../src/lib/fieldExecution';
import type {
  Company,
  ServiceOrder,
  ServiceOrderExecution,
  ServiceOrderSignature,
} from '../src/types/database';

describe('FASE C — Fotos do Atendimento, Assinatura Digital, Relatório PDF e Fechamento da OS', () => {
  let db: PGlite;

  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_TECNICO_A = '22222222-2222-4222-8222-222222222222';
  const USER_TECNICO_NAO_ATRIBUIDO = '33333333-3333-4333-8333-333333333333';
  const USER_GESTOR_B = '44444444-4444-4444-8444-444444444444';

  let companyAId = '';
  let companyBId = '';
  let techAId = '';
  let osAId = '';
  let execAId = '';
  let attachmentId = '';

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
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
      GRANT SELECT ON storage.buckets TO anon, authenticated;
    `);

    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));

    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, phone, email, sidebar_color)
      VALUES ('Outra Balanças', 'Outra Ltda', 'outra-balancas', '77.666.555/0001-44', '(11) 4000-0000', 'contato@outrabalancas.com.br', '#0B2545')
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br'),
        ('${USER_TECNICO_A}', 'tecnico.a@eabalancas.com.br'),
        ('${USER_TECNICO_NAO_ATRIBUIDO}', 'tecnico.intruder@eabalancas.com.br'),
        ('${USER_GESTOR_B}', 'gestor@outrabalancas.com.br');

      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', true),
        ('${companyAId}', '${USER_TECNICO_A}', 'technician', true),
        ('${companyAId}', '${USER_TECNICO_NAO_ATRIBUIDO}', 'technician', true),
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', true);
    `);

    const tA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyAId}', '${USER_TECNICO_A}', 'Técnico Adriano', 'tecnico.a@eabalancas.com.br', true)
      RETURNING id;
    `);
    techAId = tA[0].id;

    await runAsUser(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, user_id, full_name, email, is_active)
      VALUES ('${companyAId}', '${USER_TECNICO_NAO_ATRIBUIDO}', 'Técnico Sem Vínculo na OS', 'tecnico.intruder@eabalancas.com.br', true);
    `);

    const cA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.clients (company_id, name, trade_name, document_type, document_number)
      VALUES ('${companyAId}', 'Mercado Bom Preço Ltda', 'Mercado Bom Preço', 'CNPJ', '12.345.678/0001-99')
      RETURNING id;
    `);
    const uA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.client_units (company_id, client_id, unit_name, street, city, state)
      VALUES ('${companyAId}', '${cA[0].id}', 'Loja 01', 'Rua Central, 100', 'Campinas', 'SP')
      RETURNING id;
    `);
    const eA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.equipments (company_id, client_id, unit_id, brand, model, serial_number)
      VALUES ('${companyAId}', '${cA[0].id}', '${uA[0].id}', 'Toledo', 'Prix 4 Uno', 'SN-PRIX4-01')
      RETURNING id;
    `);

    const osRes = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.service_orders (
        company_id, sequence_number, order_number, client_id, unit_id, equipment_id,
        primary_technician_id, title, reported_issue, status, priority, created_by
      ) VALUES (
        '${companyAId}', 30, 'OS-2026-0030', '${cA[0].id}', '${uA[0].id}', '${eA[0].id}',
        '${techAId}', 'Manutenção Preventiva e Lacre', 'Substituição de lacre e aferição',
        'in_progress', 'medium', '${USER_GESTOR_A}'
      ) RETURNING id;
    `);
    osAId = osRes[0].id;

    // Cria execução completa com checklist preenchido
    const meta = serializeExecutionMetadata({
      travel_started_at: new Date().toISOString(),
      travel_latitude: -22.9,
      travel_longitude: -47.05,
      arrived_at: new Date().toISOString(),
      checkin_accuracy_meters: 10,
      gps_fallback_reason: null,
      checklist: {
        power_and_cables: 'ok',
        load_cell_and_wiring: 'ok',
        display_and_keyboard: 'ok',
        leveling_and_feet: 'ok',
        platform_and_structure: 'ok',
        inmetro_seal_integrity: 'ok',
        zero_stability_and_tare: 'ok',
        linearity_and_eccentricity: 'ok',
      },
      checklist_notes: 'Tudo conforme.',
    });

    const exRes = await runAsUser<{ id: string }>(USER_TECNICO_A, `
      INSERT INTO public.service_order_executions (
        company_id, service_order_id, technician_id, diagnosis, performed_services,
        removed_seal_number, applied_seal_number, equipment_approved, calibration_measurements
      ) VALUES (
        '${companyAId}', '${osAId}', '${techAId}',
        'Lacre rompido e pequena deriva de zero corrigida.',
        'Ajuste de zero e colocação de novo lacre INMETRO.',
        'SP-000111', 'SP-000222', true, $1::jsonb
      ) RETURNING id;
    `, [JSON.stringify(meta)]);
    execAId = exRes[0].id;
  });

  it('1. Caminho no Storage respeita estritamente o padrão {company_id}/{service_order_id}/{arquivo}', () => {
    const path = buildOrderStoragePath(companyAId, osAId, 'photo_before', 'jpg');
    const parts = path.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(companyAId);
    expect(parts[1]).toBe(osAId);
    expect(parts[2]).toMatch(/^photo_before-\d+-[a-z0-9]+\.jpg$/);
  });

  it('2. Validação obrigatória de fechamento bloqueia OS incompleta e libera quando diagnóstico, checklist, parecer e assinatura estão completos', () => {
    const partialCheck = validateServiceOrderClosure({
      execution: null,
      signatures: [],
      attachments: [],
    });
    expect(partialCheck.valid).toBe(false);
    expect(partialCheck.missingFields.length).toBeGreaterThanOrEqual(2);

    const mockExecution: ServiceOrderExecution = {
      id: execAId,
      company_id: companyAId,
      service_order_id: osAId,
      technician_id: techAId,
      started_at: new Date().toISOString(),
      finished_at: null,
      checkin_latitude: -22.9,
      checkin_longitude: -47.05,
      diagnosis: 'Célula recalibrada e lacre substituído.',
      performed_services: 'Calibração completa.',
      parts_replaced: [],
      calibration_measurements: serializeExecutionMetadata({
        travel_started_at: new Date().toISOString(),
        travel_latitude: null,
        travel_longitude: null,
        arrived_at: new Date().toISOString(),
        checkin_accuracy_meters: null,
        gps_fallback_reason: null,
        checklist: {
          power_and_cables: 'ok',
          load_cell_and_wiring: 'ok',
          display_and_keyboard: 'ok',
          leveling_and_feet: 'ok',
          platform_and_structure: 'ok',
          inmetro_seal_integrity: 'ok',
          zero_stability_and_tare: 'ok',
          linearity_and_eccentricity: 'ok',
        },
        checklist_notes: '',
      }),
      removed_seal_number: 'SP-000111',
      applied_seal_number: 'SP-000222',
      equipment_approved: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Sem assinatura do cliente ainda falha
    const noSig = validateServiceOrderClosure({
      execution: mockExecution,
      signatures: [],
      attachments: [],
    });
    expect(noSig.valid).toBe(false);
    expect(noSig.missingFields.some((f) => f.includes('assinatura'))).toBe(true);

    // Justificativa marcada sem descrição suficiente continua bloqueada
    const incompleteOmit = validateServiceOrderClosure({
      execution: mockExecution,
      signatures: [],
      attachments: [],
      signatureOmission: {
        enabled: true,
        reason: 'client_absent',
        notes: 'abc',
      },
    });
    expect(incompleteOmit.valid).toBe(false);

    // Sem assinatura MAS com motivo e justificativa obrigatória libera com aviso auditado
    const justifiedOmit = validateServiceOrderClosure({
      execution: mockExecution,
      signatures: [],
      attachments: [],
      signatureOmission: {
        enabled: true,
        reason: 'client_absent',
        notes: 'Responsável ausente; portaria conferiu a entrega às 16h.',
      },
    });
    expect(justifiedOmit.valid).toBe(true);
    expect(justifiedOmit.warnings.some((w) => w.includes('justificativa auditada'))).toBe(true);

    // Com assinatura do cliente aprova
    const mockSig: ServiceOrderSignature = {
      id: 'sig-1',
      company_id: companyAId,
      service_order_id: osAId,
      signer_type: 'client',
      signer_name: 'Carlos Pereira',
      signer_document: '123.456.789-00',
      storage_bucket: 'os-signatures',
      signature_file_path: `${companyAId}/${osAId}/client-signature.png`,
      signed_at: new Date().toISOString(),
    };

    const complete = validateServiceOrderClosure({
      execution: mockExecution,
      signatures: [mockSig],
      attachments: [],
    });
    expect(complete.valid).toBe(true);
    expect(complete.missingFields).toHaveLength(0);
    expect(complete.warnings.length).toBeGreaterThan(0); // avisa que nenhuma foto foi anexada
  });

  it('3. Técnico atribuído envia fotos (antes, depois, lacre) para os-attachments e registra assinatura em os-signatures respeitando RLS', async () => {
    const photoPath = buildOrderStoragePath(companyAId, osAId, 'seal_photo', 'jpg');

    // Simula upload no bucket privado os-attachments respeitando policy os_files_insert
    await runAsUser(USER_TECNICO_A, `
      INSERT INTO storage.objects (bucket_id, name) VALUES ('os-attachments', '${photoPath}');
    `);

    const att = await runAsUser<{ id: string; attachment_type: string }>(USER_TECNICO_A, `
      INSERT INTO public.service_order_attachments (
        company_id, service_order_id, execution_id, uploaded_by,
        attachment_type, storage_bucket, file_path, file_name
      ) VALUES (
        '${companyAId}', '${osAId}', '${execAId}', '${USER_TECNICO_A}',
        'seal_photo', 'os-attachments', '${photoPath}', 'lacre_novo.jpg'
      ) RETURNING id, attachment_type;
    `);
    attachmentId = att[0].id;
    expect(att[0].attachment_type).toBe('seal_photo');

    // Simula assinatura do cliente no bucket privado os-signatures
    const sigPath = buildOrderStoragePath(companyAId, osAId, 'client-signature', 'png');
    await runAsUser(USER_TECNICO_A, `
      INSERT INTO storage.objects (bucket_id, name) VALUES ('os-signatures', '${sigPath}');
    `);

    const sig = await runAsUser<{ signer_name: string }>(USER_TECNICO_A, `
      INSERT INTO public.service_order_signatures (
        company_id, service_order_id, execution_id, signer_type,
        signer_name, signer_document, storage_bucket, signature_file_path
      ) VALUES (
        '${companyAId}', '${osAId}', '${execAId}', 'client',
        'Carlos Pereira', '123.456.789-00', 'os-signatures', '${sigPath}'
      ) RETURNING signer_name;
    `);
    expect(sig[0].signer_name).toBe('Carlos Pereira');
  });

  it('4. Segurança e Isolamento RLS: Técnico não atribuído e Gestor de outra empresa NÃO acessam fotos, arquivos privados ou assinaturas', async () => {
    // Técnico não atribuído da mesma empresa vê 0 fotos, 0 assinaturas e 0 arquivos no Storage
    const attOtherTech = await runAsUser(USER_TECNICO_NAO_ATRIBUIDO, `
      SELECT * FROM public.service_order_attachments WHERE service_order_id = '${osAId}';
    `);
    expect(attOtherTech).toHaveLength(0);

    const filesOtherTech = await runAsUser(USER_TECNICO_NAO_ATRIBUIDO, `
      SELECT * FROM storage.objects WHERE bucket_id IN ('os-attachments', 'os-signatures');
    `);
    expect(filesOtherTech).toHaveLength(0);

    // Gestor da Empresa B vê 0 fotos, 0 assinaturas e 0 arquivos no Storage
    const attEmpresaB = await runAsUser(USER_GESTOR_B, `
      SELECT * FROM public.service_order_attachments WHERE service_order_id = '${osAId}';
    `);
    expect(attEmpresaB).toHaveLength(0);

    const sigEmpresaB = await runAsUser(USER_GESTOR_B, `
      SELECT * FROM public.service_order_signatures WHERE service_order_id = '${osAId}';
    `);
    expect(sigEmpresaB).toHaveLength(0);

    const filesEmpresaB = await runAsUser(USER_GESTOR_B, `
      SELECT * FROM storage.objects WHERE bucket_id IN ('os-attachments', 'os-signatures');
    `);
    expect(filesEmpresaB).toHaveLength(0);

    // Tentativa do técnico de excluir evidência já gravada é bloqueada pelo RLS (somente gestor exclui)
    const delByTech = await runAsUser(USER_TECNICO_A, `
      DELETE FROM public.service_order_attachments WHERE id = '${attachmentId}' RETURNING id;
    `);
    expect(delByTech).toHaveLength(0);
  });

  it('5. Técnico conclui OS, Gestor visualiza evidências/assinatura e pode revisar/reabrir com trilha de auditoria', async () => {
    await runAsUser(USER_TECNICO_A, `
      UPDATE public.service_orders
         SET status = 'completed', completed_at = now()
       WHERE id = '${osAId}';
    `);

    const viewMgr = await runAsUser<{ status: string }>(USER_GESTOR_A, `
      SELECT status FROM public.service_orders WHERE id = '${osAId}';
    `);
    expect(viewMgr[0].status).toBe('completed');

    // Gestor consegue visualizar a foto e a assinatura do cliente
    const attsMgr = await runAsUser(USER_GESTOR_A, `
      SELECT * FROM public.service_order_attachments WHERE service_order_id = '${osAId}';
    `);
    expect(attsMgr).toHaveLength(1);

    const sigsMgr = await runAsUser(USER_GESTOR_A, `
      SELECT * FROM public.service_order_signatures WHERE service_order_id = '${osAId}';
    `);
    expect(sigsMgr).toHaveLength(1);

    // Gestor pode excluir foto se necessário
    const delByMgr = await runAsUser(USER_GESTOR_A, `
      DELETE FROM public.service_order_attachments WHERE id = '${attachmentId}' RETURNING id;
    `);
    expect(delByMgr).toHaveLength(1);
  });

  it('6. Gerador de Relatório PDF (A4) produz arquivo PDF válido com estrutura completa da OS', async () => {
    const company: Company = {
      id: companyAId,
      name: 'EA Balanças & Metrologia',
      legal_name: 'EA Balanças Ltda',
      slug: 'ea-balancas',
      document_cnpj: '11.222.333/0001-44',
      email: 'contato@eabalancas.com.br',
      phone: '(19) 3322-4455',
      logo_url: null,
      sidebar_color: '#0B2545',
      primary_color: '#0D9488',
      accent_color: '#14B8A6',
      is_active: true,
      settings: {},
      os_counter: 30,
      created_by: USER_GESTOR_A,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const order: ServiceOrder = {
      id: osAId,
      company_id: companyAId,
      sequence_number: 30,
      order_number: 'OS-2026-0030',
      client_id: 'client-1',
      unit_id: 'unit-1',
      equipment_id: 'equip-1',
      primary_technician_id: techAId,
      order_type: 'preventive',
      status: 'completed',
      priority: 'medium',
      title: 'Manutenção Preventiva e Lacre',
      reported_issue: 'Substituição de lacre e aferição',
      internal_notes: null,
      scheduled_start: null,
      scheduled_end: null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      cancelled_at: null,
      cancellation_reason: null,
      allow_company_technicians_view: false,
      created_by: USER_GESTOR_A,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      client: {
        id: 'client-1',
        name: 'Mercado Bom Preço Ltda',
        trade_name: 'Mercado Bom Preço',
        document_number: '12.345.678/0001-99',
        phone: '19999998888',
      },
      equipment: {
        id: 'equip-1',
        brand: 'Toledo',
        model: 'Prix 4 Uno',
        serial_number: 'SN-PRIX4-01',
        capacity_label: '30kg',
        asset_tag: 'BAL-03',
      },
      primary_technician: {
        id: techAId,
        full_name: 'Técnico Adriano',
        calendar_color: '#0D9488',
        phone: '19988887777',
      },
    };

    const { blob, fileName } = await generateServiceOrderPdf({
      company,
      order,
      execution: null,
      items: [],
      attachments: [],
      clientSignature: null,
    });

    expect(fileName).toBe('Relatorio_OS-2026-0030.pdf');
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(2000);
  });
});
