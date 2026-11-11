import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  detectHorizontalMonthSwipe,
  getMonthGridDays,
  isDraggableServiceOrder,
  shiftScheduledRangeToDate,
  toLocalDateKey,
} from '../src/lib/scheduleCalendar';
import {
  buildWhatsAppUrl,
  formatPhone,
  isValidBrazilianPhone,
  technicianSchema,
  clientSchema,
} from '../src/lib/validation';

describe('1. Agenda Mensal Estilo Google Agenda (Calendário, Swipe e Reagendamento)', () => {
  it('gera grade mensal completa iniciando no domingo e marca o dia de hoje', () => {
    const today = new Date(2026, 10, 11); // 11 de Novembro de 2026
    const cells = getMonthGridDays(2026, 10, today);
    expect(cells.length).toBe(35);
    expect(cells[0].date.getDay()).toBe(0); // Domingo
    expect(cells[cells.length - 1].date.getDay()).toBe(6); // Sábado

    const todayCell = cells.find((c) => c.dateKey === '2026-11-11');
    expect(todayCell?.isToday).toBe(true);
    expect(todayCell?.inCurrentMonth).toBe(true);
  });

  it('move agendamento de data preservando horário local e duração da OS', () => {
    const start = new Date(2026, 10, 11, 9, 30, 0).toISOString();
    const end = new Date(2026, 10, 11, 11, 45, 0).toISOString();

    const shifted = shiftScheduledRangeToDate(start, end, '2026-11-18');
    expect(toLocalDateKey(shifted.scheduled_start)).toBe('2026-11-18');

    const newStart = new Date(shifted.scheduled_start);
    const newEnd = new Date(shifted.scheduled_end!);
    expect(newStart.getHours()).toBe(9);
    expect(newStart.getMinutes()).toBe(30);
    expect(newEnd.getTime() - newStart.getTime()).toBe(135 * 60 * 1000);
  });

  it('detecta gesto horizontal de troca de mês sem prejudicar rolagem vertical', () => {
    expect(detectHorizontalMonthSwipe(250, 200, 140, 210)).toBe('next');
    expect(detectHorizontalMonthSwipe(100, 200, 210, 215)).toBe('prev');
    // Rolagem vertical comum não dispara troca de mês
    expect(detectHorizontalMonthSwipe(200, 100, 230, 320)).toBeNull();
    // Toque curto acidental não dispara
    expect(detectHorizontalMonthSwipe(200, 200, 175, 202)).toBeNull();
  });

  it('respeita permissões de perfil e bloqueia arrastar OS concluídas ou canceladas', () => {
    const scheduled = { status: 'scheduled' as const, scheduled_start: '2026-11-11T10:00:00Z' };
    const completed = { status: 'completed' as const, scheduled_start: '2026-11-11T10:00:00Z' };

    expect(isDraggableServiceOrder(scheduled, true)).toBe(true);
    expect(isDraggableServiceOrder(scheduled, false)).toBe(false);
    expect(isDraggableServiceOrder(completed, true)).toBe(false);
  });
});

describe('2. Correção do Telefone Brasileiro (9 dígitos celular e 8 dígitos fixo)', () => {
  it('formata celular com 11 dígitos, fixo com 10 dígitos e número colado com +55 sem truncar', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
    expect(formatPhone('+55 (11) 98765-4321')).toBe('(11) 98765-4321');
    expect(formatPhone('011987654321')).toBe('(11) 98765-4321');
  });

  it('valida 10 ou 11 dígitos nacionais nos schemas de técnico e cliente', () => {
    expect(isValidBrazilianPhone('(11) 98765-4321')).toBe(true);
    expect(isValidBrazilianPhone('(11) 3333-4444')).toBe(true);
    expect(isValidBrazilianPhone('(11) 9876-543')).toBe(false);

    const techOk = technicianSchema.safeParse({
      full_name: 'Carlos Silva',
      phone: '11987654321',
      calendar_color: '#0D9488',
    });
    expect(techOk.success).toBe(true);
    if (techOk.success) {
      expect(techOk.data.phone).toBe('(11) 98765-4321');
    }

    const techShort = technicianSchema.safeParse({
      full_name: 'Carlos Silva',
      phone: '(11) 9876-543',
      calendar_color: '#0D9488',
    });
    expect(techShort.success).toBe(false);

    const clientFixedOk = clientSchema.safeParse({
      name: 'Padaria Central',
      document_type: 'CNPJ',
      phone: '1132221100',
    });
    expect(clientFixedOk.success).toBe(true);
  });

  it('monta URL do WhatsApp com +55 sem duplicar código de país', () => {
    expect(buildWhatsAppUrl('(11) 98765-4321', 'Oi')).toBe(
      'https://wa.me/5511987654321?text=Oi'
    );
    expect(buildWhatsAppUrl('+55 (11) 98765-4321', 'Oi')).toBe(
      'https://wa.me/5511987654321?text=Oi'
    );
    expect(buildWhatsAppUrl(null, 'Oi')).toBe('https://wa.me/?text=Oi');
  });
});

describe('3. Fluxo de Revogação e Novo Convite para Técnicos (PGlite)', () => {
  let db: PGlite;
  const USER_GESTOR = 'cccccccc-1111-4111-8111-111111111111';
  let companyId = '';
  let techId = '';

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
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
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
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      CREATE SCHEMA IF NOT EXISTS storage;
      GRANT USAGE ON SCHEMA storage TO anon, authenticated;
      CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner uuid DEFAULT auth.uid(), created_at timestamptz DEFAULT now());
    `);

    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/005_technician_invitation_system.sql'), 'utf-8'));

    const comp = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, phone, email, sidebar_color)
      VALUES ('EA Balanças', 'EA Balanças Ltda', 'ea-balancas', '11.222.333/0001-44', '(11) 99999-0000', 'contato@eabalancas.com.br', '#0B2545')
      RETURNING id;
    `);
    companyId = comp.rows[0].id;

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${USER_GESTOR}', 'gestor@eabalancas.com.br');
      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES ('${companyId}', '${USER_GESTOR}', 'manager', true);
    `);

    const tRes = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.technicians (company_id, full_name, email, phone, is_active)
      VALUES ('${companyId}', 'Técnico Convite', 'tecnico.novo@eabalancas.com.br', '(11) 98765-4321', true)
      RETURNING id;
    `);
    techId = tRes[0].id;
  });

  it('permite revogar convite antigo (invalidando o link) e gerar um novo convite individual', async () => {
    const inv1 = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.company_invitations (company_id, email, full_name, role, technician_id, invited_by)
      VALUES ('${companyId}', 'tecnico.novo@eabalancas.com.br', 'Técnico Convite', 'technician', '${techId}', '${USER_GESTOR}')
      RETURNING id;
    `);
    const inv1Id = inv1[0].id;

    const val1 = await runAsUser<{ validate_invitation: { valid: boolean; company_name: string } }>(
      null,
      `SELECT public.validate_invitation('${inv1Id}'::uuid);`
    );
    expect(val1[0].validate_invitation.valid).toBe(true);
    expect(val1[0].validate_invitation.company_name).toBe('EA Balanças');

    // Gestor revoga o convite 1
    await runAsUser(USER_GESTOR, `
      UPDATE public.company_invitations SET status = 'revoked'
      WHERE id = '${inv1Id}' AND company_id = '${companyId}';
    `);

    const valRevoked = await runAsUser<{ validate_invitation: { valid: boolean; reason: string } }>(
      null,
      `SELECT public.validate_invitation('${inv1Id}'::uuid);`
    );
    expect(valRevoked[0].validate_invitation.valid).toBe(false);
    expect(valRevoked[0].validate_invitation.reason).toMatch(/revogado/i);

    // Gestor gera novo convite (novo UUID válido)
    const inv2 = await runAsUser<{ id: string }>(USER_GESTOR, `
      INSERT INTO public.company_invitations (company_id, email, full_name, role, technician_id, invited_by)
      VALUES ('${companyId}', 'tecnico.novo@eabalancas.com.br', 'Técnico Convite', 'technician', '${techId}', '${USER_GESTOR}')
      RETURNING id;
    `);
    expect(inv2[0].id).not.toBe(inv1Id);

    const val2 = await runAsUser<{ validate_invitation: { valid: boolean } }>(
      null,
      `SELECT public.validate_invitation('${inv2[0].id}'::uuid);`
    );
    expect(val2[0].validate_invitation.valid).toBe(true);
  });
});
