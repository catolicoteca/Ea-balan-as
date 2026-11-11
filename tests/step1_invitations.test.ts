import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ETAPA 1 — Sistema de Convites de Técnicos por WhatsApp e Ativação Segura', () => {
  let db: PGlite;

  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_GESTOR_B = '22222222-2222-4222-8222-222222222222';
  const USER_TECNICO_A = '33333333-3333-4333-8333-333333333333';
  const USER_ATTACKER = '44444444-4444-4444-8444-444444444444';
  const USER_UNCONFIRMED = '66666666-6666-4666-8666-666666666666';

  let companyAId = '';
  let companyBId = '';
  let techRecordId = '';
  let validInvitationId = '';
  let expiredInvitationId = '';
  let unconfirmedInvitationId = '';

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

    // Setup Supabase auth mock
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
        email_confirmed_at timestamptz,
        confirmed_at timestamptz,
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

    // Aplica migrações 001, 003, 004 e 005
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/005_technician_invitation_system.sql'), 'utf-8'));

    // Configura Empresa A (EA Balanças) e Empresa B (Concorrente)
    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, phone, email, sidebar_color)
      VALUES ('Metrologia Brasil', 'Metrologia Brasil Ltda', 'metrologia-brasil', '99.888.777/0001-66', '(19) 3322-1100', 'contato@metrobrasil.com.br', '#0B2545')
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    // Registra gestores e usuários em auth.users (com e-mail confirmado)
    await db.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br', now()),
        ('${USER_GESTOR_B}', 'gestor@metrobrasil.com.br', now()),
        ('${USER_TECNICO_A}', 'roberto.campo@eabalancas.com.br', now()),
        ('${USER_ATTACKER}', 'invasor@hacker.com', now());

      INSERT INTO public.company_memberships (company_id, user_id, role, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', true),
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', true);
    `);

    // Gestor A cadastra técnico Roberto na Empresa A
    const techInsert = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, full_name, email, phone, is_active)
      VALUES ('${companyAId}', 'Roberto Metrologista', 'roberto.campo@eabalancas.com.br', '(19) 98877-6655', true)
      RETURNING id;
    `);
    techRecordId = techInsert[0].id;

    // Cria convite válido (recente)
    const invA = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.company_invitations (company_id, email, full_name, role, technician_id, invited_by, status, created_at)
      VALUES ('${companyAId}', 'roberto.campo@eabalancas.com.br', 'Roberto Metrologista', 'technician', '${techRecordId}', '${USER_GESTOR_A}', 'pending', now())
      RETURNING id;
    `);
    validInvitationId = invA[0].id;

    // Cria convite expirado (8 dias atrás)
    const invExp = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.company_invitations (company_id, email, full_name, role, invited_by, status, created_at)
      VALUES ('${companyAId}', 'antigo.tecnico@eabalancas.com.br', 'Técnico Antigo', 'technician', '${USER_GESTOR_A}', 'pending', now() - interval '8 days')
      RETURNING id;
    `);
    expiredInvitationId = invExp[0].id;

    // Cria convite para usuário que passará por confirmação de e-mail
    const invUnconf = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.company_invitations (company_id, email, full_name, role, invited_by, status, created_at)
      VALUES ('${companyAId}', 'aguardando.confirmacao@eabalancas.com.br', 'Técnico Pendente', 'technician', '${USER_GESTOR_A}', 'pending', now())
      RETURNING id;
    `);
    unconfirmedInvitationId = invUnconf[0].id;
  });

  it('1. validate_invitation deve ser acessível publicamente (anon) e retornar dados seguros para exibição da tela de ativação', async () => {
    const result = await runAsUser<{ validate_invitation: { valid: boolean; email: string; company_name: string; role: string } }>(
      null,
      `SELECT public.validate_invitation('${validInvitationId}') as validate_invitation;`
    );

    const data = result[0].validate_invitation;
    expect(data.valid).toBe(true);
    expect(data.email).toBe('roberto.campo@eabalancas.com.br');
    expect(data.company_name).toContain('EA Balanças');
    expect(data.role).toBe('technician');
  });

  it('2. validate_invitation deve rejeitar tokens inexistentes e identificar convites expirados (> 7 dias)', async () => {
    // Token inexistente
    const fakeToken = '00000000-0000-0000-0000-000000000000';
    const fakeRes = await runAsUser<{ validate_invitation: { valid: boolean; reason: string } }>(
      null,
      `SELECT public.validate_invitation('${fakeToken}') as validate_invitation;`
    );
    expect(fakeRes[0].validate_invitation.valid).toBe(false);
    expect(fakeRes[0].validate_invitation.reason).toContain('não encontrado');

    // Token expirado
    const expRes = await runAsUser<{ validate_invitation: { valid: boolean; expired: boolean; reason: string } }>(
      null,
      `SELECT public.validate_invitation('${expiredInvitationId}') as validate_invitation;`
    );
    expect(expRes[0].validate_invitation.valid).toBe(false);
    expect(expRes[0].validate_invitation.expired).toBe(true);
    expect(expRes[0].validate_invitation.reason).toContain('expirou');
  });

  it('3. accept_company_invitation impede que usuário com e-mail divergente tente usurpar o convite', async () => {
    await expect(
      runAsUser(
        USER_ATTACKER,
        `SELECT public.accept_company_invitation('${validInvitationId}');`
      )
    ).rejects.toThrow(/O e-mail da sua conta .* não corresponde ao e-mail deste convite/);
  });

  it('4. accept_company_invitation impede a ativação de convite expirado', async () => {
    const expiredUser = '55555555-5555-5555-8555-555555555555';
    await db.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('${expiredUser}', 'antigo.tecnico@eabalancas.com.br', now());
    `);

    await expect(
      runAsUser(
        expiredUser,
        `SELECT public.accept_company_invitation('${expiredInvitationId}');`
      )
    ).rejects.toThrow(/Este convite expirou/);
  });

  it('5. handle_new_auth_user PRESERVA o convite como pendente quando a confirmação de e-mail estiver habilitada e ainda não confirmada', async () => {
    // Simula cadastro pelo Supabase Auth com confirmação de e-mail ativada (email_confirmed_at = NULL)
    await db.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      VALUES ('${USER_UNCONFIRMED}', 'aguardando.confirmacao@eabalancas.com.br', NULL, '{"full_name":"Técnico Pendente"}');
    `);

    // Convite DEVE permanecer 'pending' no banco, garantindo que acesso não seja concedido prematuramente
    const inv = await runAsUser<{ status: string }>(
      USER_GESTOR_A,
      `SELECT status FROM public.company_invitations WHERE id = '${unconfirmedInvitationId}';`
    );
    expect(inv[0].status).toBe('pending');

    // Nenhuma afiliação criada antes da confirmação
    const member = await runAsUser(
      USER_GESTOR_A,
      `SELECT * FROM public.company_memberships WHERE company_id = '${companyAId}' AND user_id = '${USER_UNCONFIRMED}';`
    );
    expect(member).toHaveLength(0);
  });

  it('6. accept_company_invitation ativa com sucesso o técnico legítimo, vincula à empresa e amarra role no servidor', async () => {
    const res = await runAsUser<{ accept_company_invitation: { success: boolean; company_id: string; role: string } }>(
      USER_TECNICO_A,
      `SELECT public.accept_company_invitation('${validInvitationId}') as accept_company_invitation;`
    );
    expect(res[0].accept_company_invitation.success).toBe(true);
    expect(res[0].accept_company_invitation.company_id).toBe(companyAId);
    expect(res[0].accept_company_invitation.role).toBe('technician');

    const member = await runAsUser<{ role: string; is_active: boolean }>(
      USER_GESTOR_A,
      `SELECT role, is_active FROM public.company_memberships WHERE company_id = '${companyAId}' AND user_id = '${USER_TECNICO_A}';`
    );
    expect(member[0].role).toBe('technician');
    expect(member[0].is_active).toBe(true);

    const tech = await runAsUser<{ user_id: string }>(
      USER_GESTOR_A,
      `SELECT user_id FROM public.technicians WHERE id = '${techRecordId}';`
    );
    expect(tech[0].user_id).toBe(USER_TECNICO_A);

    const inv = await runAsUser<{ status: string; accepted_by: string }>(
      USER_GESTOR_A,
      `SELECT status, accepted_by FROM public.company_invitations WHERE id = '${validInvitationId}';`
    );
    expect(inv[0].status).toBe('accepted');
    expect(inv[0].accepted_by).toBe(USER_TECNICO_A);
  });

  it('7. Técnico já cadastrado pode aceitar convite legítimo sem gerar conta ou vínculo duplicado', async () => {
    // Cria novo convite para o técnico Roberto (que já tem conta no sistema)
    const newInv = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.company_invitations (company_id, email, full_name, role, invited_by, status, created_at)
      VALUES ('${companyAId}', 'roberto.campo@eabalancas.com.br', 'Roberto Metrologista', 'technician', '${USER_GESTOR_A}', 'pending', now())
      RETURNING id;
    `);
    const newInvId = newInv[0].id;

    // Técnico Roberto aceita o novo convite enquanto autenticado
    const acceptRes = await runAsUser<{ accept_company_invitation: { success: boolean } }>(
      USER_TECNICO_A,
      `SELECT public.accept_company_invitation('${newInvId}') as accept_company_invitation;`
    );
    expect(acceptRes[0].accept_company_invitation.success).toBe(true);

    // Confirma que não foram criados memberships duplicados
    const members = await runAsUser(
      USER_GESTOR_A,
      `SELECT * FROM public.company_memberships WHERE company_id = '${companyAId}' AND user_id = '${USER_TECNICO_A}';`
    );
    expect(members).toHaveLength(1);
  });

  it('8. resend_company_invitation: Gestor de outra empresa (Empresa B) NÃO pode renovar convite da Empresa A', async () => {
    await expect(
      runAsUser(
        USER_GESTOR_B,
        `SELECT public.resend_company_invitation('${expiredInvitationId}');`
      )
    ).rejects.toThrow(/Apenas gestores da empresa têm permissão para reenviar convites/);
  });

  it('9. resend_company_invitation: Técnico NÃO pode renovar convite', async () => {
    await expect(
      runAsUser(
        USER_TECNICO_A,
        `SELECT public.resend_company_invitation('${expiredInvitationId}');`
      )
    ).rejects.toThrow(/Apenas gestores da empresa têm permissão para reenviar convites/);
  });

  it('10. resend_company_invitation: Gestor legítimo da Empresa A renova convite expirado e status volta a ser pendente', async () => {
    const resend = await runAsUser<{ resend_company_invitation: { success: boolean; invitation_id: string } }>(
      USER_GESTOR_A,
      `SELECT public.resend_company_invitation('${expiredInvitationId}') as resend_company_invitation;`
    );
    expect(resend[0].resend_company_invitation.success).toBe(true);

    const validated = await runAsUser<{ validate_invitation: { valid: boolean; email: string } }>(
      null,
      `SELECT public.validate_invitation('${expiredInvitationId}') as validate_invitation;`
    );
    expect(validated[0].validate_invitation.valid).toBe(true);
    expect(validated[0].validate_invitation.email).toBe('antigo.tecnico@eabalancas.com.br');
  });

  it('11. Formatação e geração da mensagem de WhatsApp e Link de Ativação', () => {
    const origin = 'https://app.eabalancas.com.br';
    const invitationId = validInvitationId;
    const techName = 'Roberto Metrologista';
    const techPhone = '19988776655';
    const companyName = 'EA Balanças';

    const activationLink = `${origin}/ativar?convite=${invitationId}`;
    const rawMessage = `Olá, ${techName}! Você foi convidado para a equipe técnica da *${companyName}*.\n\nPara ativar seu acesso ao aplicativo mobile e definir sua senha, acesse o link seguro abaixo:\n\n🔗 ${activationLink}\n\nEste link é individual e expira em 7 dias.`;
    const cleanPhone = techPhone.replace(/\D/g, '');
    const waUrl = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(rawMessage)}`;

    expect(activationLink).toBe(`https://app.eabalancas.com.br/ativar?convite=${invitationId}`);
    expect(waUrl).toContain('https://wa.me/5519988776655?text=');
    expect(waUrl).toContain(encodeURIComponent(activationLink));
    expect(decodeURIComponent(waUrl)).toContain(`*${companyName}*`);
    expect(decodeURIComponent(waUrl)).toContain(activationLink);
  });

  it('12. Bloqueio de acesso sem convite: cadastro apenas em public.technicians NÃO concede acesso nem cria membership', async () => {
    const userSemConviteId = '77777777-7777-4777-8777-777777777777';
    const emailSemConvite = 'semconvite.apenasficha@eabalancas.com.br';

    // Gestor cadastra ficha de técnico mas NÃO emite convite em company_invitations
    const techSemConvite = await runAsUser<{ id: string }>(USER_GESTOR_A, `
      INSERT INTO public.technicians (company_id, full_name, email, phone, is_active)
      VALUES ('${companyAId}', 'Técnico Sem Convite', '${emailSemConvite}', '(19) 97711-2233', true)
      RETURNING id;
    `);

    // Usuário cadastra conta com o mesmo e-mail (mesmo com e-mail confirmado)
    await db.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at)
      VALUES ('${userSemConviteId}', '${emailSemConvite}', now());
    `);

    // Valida que handle_new_auth_user NÃO vinculou o usuário nem criou membership na empresa
    const member = await runAsUser(
      USER_GESTOR_A,
      `SELECT * FROM public.company_memberships WHERE user_id = '${userSemConviteId}';`
    );
    expect(member).toHaveLength(0);

    const techRecord = await runAsUser<{ user_id: string | null }>(
      USER_GESTOR_A,
      `SELECT user_id FROM public.technicians WHERE id = '${techSemConvite[0].id}';`
    );
    expect(techRecord[0].user_id).toBeNull();
  });

  it('13. Bloqueio por e-mail não confirmado: accept_company_invitation e claim_pending_invitations barram usuário não confirmado', async () => {
    // 13.1 accept_company_invitation deve lançar exceção explícita
    await expect(
      runAsUser(
        USER_UNCONFIRMED,
        `SELECT public.accept_company_invitation('${unconfirmedInvitationId}');`
      )
    ).rejects.toThrow(/ainda não foi confirmado/);

    // 13.2 claim_pending_invitations deve retornar 0 e não vincular
    const claimed = await runAsUser<{ claim_pending_invitations: number }>(
      USER_UNCONFIRMED,
      `SELECT public.claim_pending_invitations() as claim_pending_invitations;`
    );
    expect(claimed[0].claim_pending_invitations).toBe(0);

    // Confirma que o convite continua pending e nenhuma afiliação foi criada
    const inv = await runAsUser<{ status: string }>(
      USER_GESTOR_A,
      `SELECT status FROM public.company_invitations WHERE id = '${unconfirmedInvitationId}';`
    );
    expect(inv[0].status).toBe('pending');
  });

  it('14. Retomada da ativação: após confirmar o e-mail, o técnico consegue ativar seu convite com sucesso', async () => {
    // Simula confirmação de e-mail no Supabase Auth
    await db.exec(`
      UPDATE auth.users
         SET email_confirmed_at = now()
       WHERE id = '${USER_UNCONFIRMED}';
    `);

    // Agora o técnico tenta ativar novamente
    const res = await runAsUser<{ accept_company_invitation: { success: boolean; company_id: string; role: string } }>(
      USER_UNCONFIRMED,
      `SELECT public.accept_company_invitation('${unconfirmedInvitationId}') as accept_company_invitation;`
    );
    expect(res[0].accept_company_invitation.success).toBe(true);
    expect(res[0].accept_company_invitation.company_id).toBe(companyAId);
    expect(res[0].accept_company_invitation.role).toBe('technician');

    // Valida que o membership e vínculo com a empresa foram criados
    const member = await runAsUser<{ role: string; is_active: boolean }>(
      USER_GESTOR_A,
      `SELECT role, is_active FROM public.company_memberships WHERE company_id = '${companyAId}' AND user_id = '${USER_UNCONFIRMED}';`
    );
    expect(member[0].role).toBe('technician');
    expect(member[0].is_active).toBe(true);

    const inv = await runAsUser<{ status: string; accepted_by: string }>(
      USER_GESTOR_A,
      `SELECT status, accepted_by FROM public.company_invitations WHERE id = '${unconfirmedInvitationId}';`
    );
    expect(inv[0].status).toBe('accepted');
    expect(inv[0].accepted_by).toBe(USER_UNCONFIRMED);
  });
});
