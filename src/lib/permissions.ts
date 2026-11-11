import type { EffectiveRole } from '../types/database';

export interface RolePermissions {
  canManagePlatformCompanies: boolean;
  canManageCompanySettings: boolean;
  canManageClients: boolean;
  canManageEquipments: boolean;
  canManageTechnicians: boolean;
  canCreateServiceOrder: boolean;
  canAssignTechnicians: boolean;
  canViewReports: boolean;
  canManagePriceCatalog: boolean;
  canApproveOrderItems: boolean;
}

export function getPermissionsForRole(role: EffectiveRole | null): RolePermissions {
  if (role === 'platform_admin') {
    return {
      canManagePlatformCompanies: true,
      canManageCompanySettings: true,
      canManageClients: true,
      canManageEquipments: true,
      canManageTechnicians: true,
      canCreateServiceOrder: true,
      canAssignTechnicians: true,
      canViewReports: true,
      canManagePriceCatalog: true,
      canApproveOrderItems: true,
    };
  }

  if (role === 'manager') {
    return {
      canManagePlatformCompanies: false,
      canManageCompanySettings: true,
      canManageClients: true,
      canManageEquipments: true,
      canManageTechnicians: true,
      canCreateServiceOrder: true,
      canAssignTechnicians: true,
      canViewReports: true,
      canManagePriceCatalog: true,
      canApproveOrderItems: true,
    };
  }

  // Perfil 'technician' ou sem vínculo: acesso estrito apenas às OS atribuídas (validado também por RLS no PostgreSQL)
  return {
    canManagePlatformCompanies: false,
    canManageCompanySettings: false,
    canManageClients: false,
    canManageEquipments: false,
    canManageTechnicians: false,
    canCreateServiceOrder: false,
    canAssignTechnicians: false,
    canViewReports: false,
    canManagePriceCatalog: false,
    canApproveOrderItems: false,
  };
}

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  platform_admin: 'Administrador da Plataforma',
  manager: 'Gestor da Empresa',
  technician: 'Técnico de Campo',
};
