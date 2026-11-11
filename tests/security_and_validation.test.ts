import { describe, it, expect } from 'vitest';
import { supabase, validatePublicSupabaseConfig } from '../src/lib/supabase';
import { isSchemaMissingError } from '../src/lib/errors';
import {
  companySettingsSchema,
  formatCNPJ,
  serviceOrderSchema,
  slugifyCompanyName,
} from '../src/lib/validation';
import { getPermissionsForRole } from '../src/lib/permissions';

describe('Segurança de Chaves Públicas, Validações de Formulário e Permissões', () => {
  it('aceita chave pública publishable e bloqueia chaves administrativas no frontend', () => {
    const ok = validatePublicSupabaseConfig(
      'https://gbaomygprofsdhgxrgtm.supabase.co',
      'sb_publishable_rx0v4ORNgV_7kWWv4bOFOg_xqniZPR8'
    );
    expect(ok.valid).toBe(true);

    const secretBlocked = validatePublicSupabaseConfig(
      'https://gbaomygprofsdhgxrgtm.supabase.co',
      'sb_secret_1234567890'
    );
    expect(secretBlocked.valid).toBe(false);
    expect(secretBlocked.reason).toMatch(/BLOQUEIO DE SEGURANÇA/);

    // Simula um JWT service_role codificado em base64
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const fakePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    const fakeServiceJwt = `${fakeHeader}.${fakePayload}.signature`;

    const jwtBlocked = validatePublicSupabaseConfig(
      'https://gbaomygprofsdhgxrgtm.supabase.co',
      fakeServiceJwt
    );
    expect(jwtBlocked.valid).toBe(false);
    expect(jwtBlocked.reason).toMatch(/service_role/);
  });

  it('valida corretamente formulário de Ordem de Serviço (datas e campos obrigatórios)', () => {
    const invalidRange = serviceOrderSchema.safeParse({
      client_id: '550e8400-e29b-41d4-a716-446655440000',
      order_type: 'calibration',
      priority: 'high',
      title: 'Calibração Balança 30t',
      reported_issue: 'Solicitação periódica do cliente',
      scheduled_start: '2026-11-10T14:00',
      scheduled_end: '2026-11-10T10:00',
    });
    expect(invalidRange.success).toBe(false);

    const validOrder = serviceOrderSchema.safeParse({
      client_id: '550e8400-e29b-41d4-a716-446655440000',
      order_type: 'calibration',
      priority: 'high',
      title: 'Calibração Balança 30t',
      reported_issue: 'Solicitação periódica do cliente',
      scheduled_start: '2026-11-10T09:00',
      scheduled_end: '2026-11-10T11:30',
    });
    expect(validOrder.success).toBe(true);
  });

  it('valida configurações visuais e CNPJ da empresa', () => {
    expect(formatCNPJ('12345678000190')).toBe('12.345.678/0001-90');
    expect(slugifyCompanyName('EA Balanças & Metrologia')).toBe(
      'ea-balancas-metrologia'
    );

    const badColor = companySettingsSchema.safeParse({
      name: 'EA Balanças',
      document_cnpj: '12.345.678/0001-90',
      sidebar_color: 'azul',
      primary_color: '#0D9488',
      accent_color: '#14B8A6',
    });
    expect(badColor.success).toBe(false);
  });

  it('aplica matriz de permissões por perfil na interface', () => {
    const adminPerms = getPermissionsForRole('platform_admin');
    expect(adminPerms.canManagePlatformCompanies).toBe(true);
    expect(adminPerms.canCreateServiceOrder).toBe(true);

    const managerPerms = getPermissionsForRole('manager');
    expect(managerPerms.canManagePlatformCompanies).toBe(false);
    expect(managerPerms.canManageCompanySettings).toBe(true);
    expect(managerPerms.canCreateServiceOrder).toBe(true);

    const techPerms = getPermissionsForRole('technician');
    expect(techPerms.canManagePlatformCompanies).toBe(false);
    expect(techPerms.canManageCompanySettings).toBe(false);
    expect(techPerms.canCreateServiceOrder).toBe(false);
  });

  it('conecta ao projeto real Supabase configurado com chave pública e diagnostica status do schema', async () => {
    const sessionRes = await supabase.auth.getSession();
    expect(sessionRes.error).toBeNull();

    const probe = await supabase.from('companies').select('id').limit(1);
    // Se a migração já tiver sido rodada no projeto, retorna array sem erro;
    // antes da migração manual no SQL Editor, retorna erro PGRST205 detectado por isSchemaMissingError.
    if (probe.error) {
      expect(isSchemaMissingError(probe.error)).toBe(true);
    } else {
      expect(Array.isArray(probe.data)).toBe(true);
    }
  });
});
