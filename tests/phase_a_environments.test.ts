import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canAccessManagerAppArea,
  canAccessPlatformArea,
  getDefaultHomeRoute,
} from '../src/lib/routes';

describe('FASE A — Separação dos Ambientes Metrion (/platform, /app e /tecnico)', () => {
  it('1. getDefaultHomeRoute direciona cada perfil exatamente para seu ambiente padrão', () => {
    expect(getDefaultHomeRoute(true, 'platform_admin')).toBe('/platform');
    expect(getDefaultHomeRoute(true, 'manager')).toBe('/platform');
    expect(getDefaultHomeRoute(false, 'manager')).toBe('/app/dashboard');
    expect(getDefaultHomeRoute(false, 'technician')).toBe('/tecnico/ordens');
  });

  it('2. canAccessPlatformArea restringe /platform estritamente ao Super Admin Metrion', () => {
    expect(canAccessPlatformArea(true)).toBe(true);
    expect(canAccessPlatformArea(false)).toBe(false);
  });

  it('3. canAccessManagerAppArea bloqueia técnicos e preserva acesso do Super Admin apenas com vínculo legítimo (EA Balanças)', () => {
    // Gestor comum acessa /app normalmente
    expect(canAccessManagerAppArea(false, 'manager', true)).toBe(true);

    // Técnico é estritamente bloqueado do painel gerencial /app
    expect(canAccessManagerAppArea(false, 'technician', true)).toBe(false);

    // Super Admin com vínculo legítimo de gestor (ex.: EA Balanças) mantém acesso preservado ao /app
    expect(canAccessManagerAppArea(true, 'platform_admin', true)).toBe(true);

    // Super Admin sem vínculo em outra empresa fica restrito ao /platform até o modo de suporte (Fase B)
    expect(canAccessManagerAppArea(true, 'platform_admin', false)).toBe(false);
  });

  it('4. SettingsPage da empresa assinante não mistura mais administração global de plataforma SaaS', () => {
    const settingsSrc = readFileSync(resolve('src/pages/SettingsPage.tsx'), 'utf-8');
    expect(settingsSrc).not.toContain('newTenantModal');
    expect(settingsSrc).not.toContain("tab === 'platform'");
    expect(settingsSrc).not.toContain('handleCreateNewTenant');
  });

  it('5. App.tsx implementa guardas explícitos para /platform, /app, /tecnico e preserva redirecionamentos antigos', () => {
    const appSrc = readFileSync(resolve('src/App.tsx'), 'utf-8');
    expect(appSrc).toContain('path="/platform"');
    expect(appSrc).toContain('path="/app"');
    expect(appSrc).toContain('path="/tecnico"');
    expect(appSrc).toContain('canAccessPlatformArea');
    expect(appSrc).toContain('canAccessManagerAppArea');
    // Links antigos preservados
    expect(appSrc).toContain('path="/dashboard"');
    expect(appSrc).toContain('path="/clientes"');
    expect(appSrc).toContain('path="/tecnicos"');
    expect(appSrc).toContain('path="/ordens-de-servico"');
  });

  it('6. Estrutura de Planos Metrion não gera cobranças ou faturamento fictício na Fase A', () => {
    const plansSrc = readFileSync(resolve('src/pages/PlatformPlansPage.tsx'), 'utf-8');
    expect(plansSrc).toContain('Cobrança e Assinaturas Ainda Não Implementadas');
    expect(plansSrc).toContain('A definir na integração');
  });
});
