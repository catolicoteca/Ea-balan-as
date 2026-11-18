import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ETAPA 3 — Super Admin Metrion, Gestão de Planos, Limites e Dark Mode', () => {
  let db: PGlite;

  const USER_PLATFORM_ADMIN = '00000000-0000-4000-8000-000000000000';
  const USER_GESTOR_A = '11111111-1111-4111-8111-111111111111';
  const USER_TECNICO_A = '33333333-3333-4333-8333-333333333333';
  const USER_GESTOR_B = '22222222-2222-4222-8222-222222222222';

  let companyAId = '';
  let companyBId = '';

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

    // 1. Mock do schema auth e storage do Supabase
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

    // 2. Executa a cadeia completa de migrações 001..011
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/003_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/004_seed_real_price_catalog.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/005_technician_invitation_system.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/008a_add_administrator_enum.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/008b_administrator_and_employee_auth.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/009_metrology_ordinance_and_multi_equipment_os.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/010a_add_stock_manager_enum.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/010b_stock_inventory_system.sql'), 'utf-8'));
    await db.exec(readFileSync(resolve('supabase/migrations/011_plans_subscriptions_and_limits.sql'), 'utf-8'));

    // 3. Obtém empresa A existente (criada na 001) e cria empresa B
    const compA = await db.query<{ id: string }>(`SELECT id FROM public.companies WHERE slug = 'ea-balancas'`);
    companyAId = compA.rows[0].id;

    const compB = await db.query<{ id: string }>(`
      INSERT INTO public.companies (name, legal_name, slug, document_cnpj, is_active)
      VALUES ('Metrologia Brasil', 'Metrologia Brasil Ltda', 'metrologia-brasil', '99.888.777/0001-66', true)
      RETURNING id;
    `);
    companyBId = compB.rows[0].id;

    // 4. Usuários, Membros e Perfis
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_PLATFORM_ADMIN}', 'superadmin@metrion.com.br'),
        ('${USER_GESTOR_A}', 'gestor@eabalancas.com.br'),
        ('${USER_TECNICO_A}', 'tecnico@eabalancas.com.br'),
        ('${USER_GESTOR_B}', 'gestor@metrobrasil.com.br');

      INSERT INTO public.company_memberships (company_id, user_id, role, username, is_active) VALUES
        ('${companyAId}', '${USER_GESTOR_A}', 'manager', 'gestor.ea', true),
        ('${companyAId}', '${USER_TECNICO_A}', 'technician', 'tecnico.ea', true),
        ('${companyBId}', '${USER_GESTOR_B}', 'manager', 'gestor.b', true);

      INSERT INTO public.profiles (id, full_name, email, default_company_id) VALUES
        ('${USER_PLATFORM_ADMIN}', 'Super Admin Metrion', 'superadmin@metrion.com.br', '${companyAId}'),
        ('${USER_GESTOR_A}', 'Eduardo Gestor EA', 'gestor@eabalancas.com.br', '${companyAId}'),
        ('${USER_TECNICO_A}', 'Roberto Técnico EA', 'tecnico@eabalancas.com.br', '${companyAId}'),
        ('${USER_GESTOR_B}', 'Gestor B', 'gestor@metrobrasil.com.br', '${companyBId}')
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        default_company_id = EXCLUDED.default_company_id;

      INSERT INTO public.platform_admins (user_id, is_active)
      VALUES ('${USER_PLATFORM_ADMIN}', true)
      ON CONFLICT (user_id) DO UPDATE SET is_active = true;
    `);
  });

  describe('1. Inicialização e Catálogo de Planos (Seeds & Subscrições)', () => {
    it('deve possuir os 3 planos padrão semeados (Essencial, Profissional e Enterprise)', async () => {
      const res = await db.query<{ id: string; name: string; slug: string; price: number }>(`
        SELECT id, name, slug, price FROM public.plans ORDER BY price ASC;
      `);
      expect(res.rows).toHaveLength(3);
      expect(res.rows.map((r) => r.slug)).toEqual(['essencial', 'profissional', 'enterprise']);
      expect(res.rows[0].name).toBe('Metrion Essencial');
      expect(res.rows[1].name).toBe('Metrion Profissional');
      expect(res.rows[2].name).toBe('Metrion Enterprise');
    });

    it('deve ter associado a empresa inicial ea-balancas ao plano profissional ativo via backfill', async () => {
      const sub = await db.query<{ status: string; plan_slug: string }>(`
        SELECT s.status, p.slug as plan_slug
        FROM public.subscriptions s
        JOIN public.plans p ON p.id = s.plan_id
        WHERE s.company_id = $1;
      `, [companyAId]);

      expect(sub.rows.length).toBe(1);
      expect(sub.rows[0].status).toBe('active');
      expect(sub.rows[0].plan_slug).toBe('profissional');
    });

    it('deve retornar plano efetivo correto através da função get_company_effective_plan()', async () => {
      const res = await db.query<{ plan_slug: string; max_technicians: number; has_stock_module: boolean }>(`
        SELECT 
          plan_slug, 
          (effective_limits->>'max_technicians')::int as max_technicians,
          (effective_features->>'stock')::boolean as has_stock_module
        FROM public.get_company_effective_plan($1);
      `, [companyAId]);

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].plan_slug).toBe('profissional');
      expect(res.rows[0].max_technicians).toBe(15);
      expect(res.rows[0].has_stock_module).toBe(true);
    });

    it('deve avaliar a liberação de funcionalidades via check_company_feature_enabled() sob contexto de tenant', async () => {
      // Gestor da empresa consulta feature stock (habilitada no profissional)
      const stockOk = await runAsUser<{ enabled: boolean }>(
        USER_GESTOR_A,
        `SELECT public.check_company_feature_enabled($1, 'stock') as enabled;`,
        [companyAId]
      );
      expect(stockOk[0].enabled).toBe(true);

      // Gestor consulta feature api_access (desabilitada no profissional, exclusiva do enterprise)
      const apiAccess = await runAsUser<{ enabled: boolean }>(
        USER_GESTOR_A,
        `SELECT public.check_company_feature_enabled($1, 'api_access') as enabled;`,
        [companyAId]
      );
      expect(apiAccess[0].enabled).toBe(false);
    });
  });

  describe('2. Triggers de Aplicação e Bloqueio de Limites por Empresa', () => {
    it('deve associar empresa B ao plano Essencial (limite de 3 técnicos)', async () => {
      const essencialPlan = await db.query<{ id: string }>(`
        SELECT id FROM public.plans WHERE slug = 'essencial';
      `);

      await db.query(`
        INSERT INTO public.subscriptions (company_id, plan_id, status)
        VALUES ($1, $2, 'active')
        ON CONFLICT (company_id) DO UPDATE SET plan_id = EXCLUDED.plan_id;
      `, [companyBId, essencialPlan.rows[0].id]);

      const effectiveB = await db.query<{ plan_slug: string; max_technicians: number }>(`
        SELECT plan_slug, (effective_limits->>'max_technicians')::int as max_technicians
        FROM public.get_company_effective_plan($1);
      `, [companyBId]);

      expect(effectiveB.rows[0].plan_slug).toBe('essencial');
      expect(effectiveB.rows[0].max_technicians).toBe(3);
    });

    it('deve permitir cadastrar técnicos até o limite configurado (3 técnicos na empresa B)', async () => {
      for (let i = 1; i <= 3; i++) {
        await runAsUser(
          USER_GESTOR_B,
          `
          INSERT INTO public.technicians (company_id, full_name, email)
          VALUES ($1, $2, $3);
          `,
          [companyBId, `Técnico B ${i}`, `techb${i}@metrobrasil.com.br`]
        );
      }

      const count = await db.query<{ count: string }>(`
        SELECT count(*)::text as count FROM public.technicians WHERE company_id = $1 AND is_active = true;
      `, [companyBId]);
      expect(parseInt(count.rows[0].count, 10)).toBe(3);
    });

    it('deve disparar exceção ao tentar inserir o 4º técnico excedendo o limite do plano na empresa B', async () => {
      await expect(
        runAsUser(
          USER_GESTOR_B,
          `
          INSERT INTO public.technicians (company_id, full_name, email)
          VALUES ($1, 'Técnico 4 Excedente', 'excedente@metrobrasil.com.br');
          `,
          [companyBId]
        )
      ).rejects.toThrow(/Limite de técnicos do plano atingido.*3/);
    });

    it('deve permitir expandir o limite de técnicos através de CompanyPlanOverride com justificativa de auditoria', async () => {
      // Super Admin cadastra override individual de 10 técnicos com justificativa
      await runAsUser(
        USER_PLATFORM_ADMIN,
        `
        INSERT INTO public.company_plan_overrides (
          company_id,
          override_limits,
          override_features,
          reason,
          authorized_by
        ) VALUES (
          $1,
          '{"max_technicians": 10}'::jsonb,
          '{"api_access": true}'::jsonb,
          'Expansão de técnicos aprovada pela diretoria comercial',
          $2
        );
        `,
        [companyBId, USER_PLATFORM_ADMIN]
      );

      // Super Admin grava registro no log de auditoria
      await runAsUser(
        USER_PLATFORM_ADMIN,
        `
        INSERT INTO public.plan_audit_logs (
          company_id,
          action,
          actor_user_id,
          notes
        ) VALUES (
          $1,
          'OVERRIDE_INSERT',
          $2,
          'Expansão de técnicos aprovada pela diretoria comercial'
        );
        `,
        [companyBId, USER_PLATFORM_ADMIN]
      );

      // Verifica auditoria gravada
      const audit = await db.query<{ action: string; notes: string }>(`
        SELECT action, notes FROM public.plan_audit_logs
        WHERE company_id = $1
        ORDER BY created_at DESC LIMIT 1;
      `, [companyBId]);
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].action).toBe('OVERRIDE_INSERT');
      expect(audit.rows[0].notes).toBe('Expansão de técnicos aprovada pela diretoria comercial');

      // Verifica que o plano efetivo agora reflete 10 técnicos e api_access habilitado
      const effective = await db.query<{ max_technicians: number; api_access: boolean }>(`
        SELECT 
          (effective_limits->>'max_technicians')::int as max_technicians,
          (effective_features->>'api_access')::boolean as api_access
        FROM public.get_company_effective_plan($1);
      `, [companyBId]);
      expect(effective.rows[0].max_technicians).toBe(10);
      expect(effective.rows[0].api_access).toBe(true);

      // Agora a inserção do 4º técnico sob o usuário gestor deve ter sucesso imediato
      const fourthTech = await runAsUser<{ id: string }>(
        USER_GESTOR_B,
        `
        INSERT INTO public.technicians (company_id, full_name, email)
        VALUES ($1, 'Técnico 4 Aprovado', 'tech4@metrobrasil.com.br')
        RETURNING id;
        `,
        [companyBId]
      );
      expect(fourthTech.length).toBe(1);
    });

    it('deve aplicar limite de usuários da empresa via trigger', async () => {
      // Empresa B tem plano essencial com max_users = 5 (sem override para usuários)
      // Empresa B já tem 1 membro (USER_GESTOR_B)
      const userB2 = 'bbbbbbbb-2222-4222-8222-222222222222';
      const userB3 = 'bbbbbbbb-3333-4333-8333-333333333333';
      const userB4 = 'bbbbbbbb-4444-4444-8444-444444444444';
      const userB5 = 'bbbbbbbb-5555-5555-8555-555555555555';
      const userB6Excedente = 'bbbbbbbb-6666-6666-8666-666666666666';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${userB2}', 'user2@b.com'),
          ('${userB3}', 'user3@b.com'),
          ('${userB4}', 'user4@b.com'),
          ('${userB5}', 'user5@b.com'),
          ('${userB6Excedente}', 'user6@b.com');
      `);

      for (const [idx, uid] of [userB2, userB3, userB4, userB5].entries()) {
        await runAsUser(
          USER_GESTOR_B,
          `INSERT INTO public.company_memberships (company_id, user_id, role, username)
           VALUES ($1, $2, 'technician', $3);`,
          [companyBId, uid, `tech.b.${idx + 2}`]
        );
      }

      // Tentativa do 6º usuário deve falhar (limite 5 no plano essencial)
      await expect(
        runAsUser(
          USER_GESTOR_B,
          `INSERT INTO public.company_memberships (company_id, user_id, role, username)
           VALUES ($1, $2, 'technician', 'tech.b.6');`,
          [companyBId, userB6Excedente]
        )
      ).rejects.toThrow(/Limite de colaboradores do plano atingido.*5/);
    });
  });

  describe('3. Isolamento e Segurança RLS das Tabelas de Governança', () => {
    it('deve impedir que usuários comuns (Gestores de tenant) alterem planos da plataforma', async () => {
      // Gestor tenta alterar o preço de um plano
      const updateResult = await runAsUser(
        USER_GESTOR_A,
        `UPDATE public.plans SET price = 1.00 WHERE slug = 'enterprise' RETURNING id;`
      );
      // RLS impede update retornando 0 linhas
      expect(updateResult.length).toBe(0);
    });

    it('deve impedir que usuários comuns alterem suas assinaturas ou criem overrides para si mesmos', async () => {
      // Gestor tenta alterar sua própria assinatura para enterprise diretamente
      const enterprisePlan = await db.query<{ id: string }>(`SELECT id FROM public.plans WHERE slug = 'enterprise'`);
      const subUpdate = await runAsUser(
        USER_GESTOR_A,
        `UPDATE public.subscriptions SET plan_id = $1 WHERE company_id = $2 RETURNING id;`,
        [enterprisePlan.rows[0].id, companyAId]
      );
      expect(subUpdate.length).toBe(0);

      // Gestor tenta criar override para dar 100 técnicos à sua empresa
      await expect(
        runAsUser(
          USER_GESTOR_A,
          `INSERT INTO public.company_plan_overrides (company_id, override_limits, reason)
           VALUES ($1, '{"max_technicians": 100}'::jsonb, 'Auto upgrade');`,
          [companyAId]
        )
      ).rejects.toThrow();
    });

    it('deve permitir que o Super Admin autenticado gerencie planos e assinaturas', async () => {
      // Super Admin altera o preço de um plano
      const updated = await runAsUser<{ id: string; price: number }>(
        USER_PLATFORM_ADMIN,
        `UPDATE public.plans SET price = 699.00 WHERE slug = 'enterprise' RETURNING id, price;`
      );
      expect(updated.length).toBe(1);
      expect(Number(updated[0].price)).toBe(699.00);

      // Super Admin cadastra novo plano personalizado
      const newPlan = await runAsUser<{ id: string; name: string }>(
        USER_PLATFORM_ADMIN,
        `
        INSERT INTO public.plans (
          name, slug, description, price, features, is_active
        ) VALUES (
          'Plano Corporativo Custom',
          'corporativo-custom',
          'Plano sob medida para grandes redes',
          1499.00,
          '{"stock": true, "api_access": true}'::jsonb,
          true
        ) RETURNING id, name;
        `
      );
      expect(newPlan.length).toBe(1);
      expect(newPlan[0].name).toBe('Plano Corporativo Custom');
    });
  });
});
