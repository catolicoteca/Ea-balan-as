import type { EffectiveRole } from '../types/database';

/**
 * Resolve a rota inicial padrão com base no perfil autenticado do usuário:
 * - Super Admin Metrion -> /platform
 * - Gestor de Empresa -> /app/dashboard
 * - Técnico de Campo -> /tecnico/ordens
 */
export function getDefaultHomeRoute(
  isPlatformAdmin: boolean,
  effectiveRole: EffectiveRole | null
): string {
  if (isPlatformAdmin) {
    return '/platform';
  }
  if (effectiveRole === 'technician') {
    return '/tecnico/ordens';
  }
  return '/app/dashboard';
}

/**
 * Verifica se o perfil possui permissão para acessar o ambiente /platform (Metrion SaaS).
 */
export function canAccessPlatformArea(isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin === true;
}

/**
 * Verifica se o perfil possui permissão para acessar o ambiente operacional /app (Gestor).
 * Técnicos são bloqueados do painel gerencial /app e mantidos estritamente em /tecnico.
 */
export function canAccessManagerAppArea(
  isPlatformAdmin: boolean,
  effectiveRole: EffectiveRole | null,
  hasCompanyMembership: boolean
): boolean {
  if (effectiveRole === 'technician' && !isPlatformAdmin) {
    return false;
  }
  if (isPlatformAdmin) {
    // Na Fase A, o Super Admin entra no /app para administrar empresas às quais tem vínculo legítimo (ex.: EA Balanças)
    return hasCompanyMembership;
  }
  return effectiveRole === 'manager';
}
