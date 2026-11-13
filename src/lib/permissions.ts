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
  canManageStock: boolean;
  canManageFinance: boolean;
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
      canManageStock: true,
      canManageFinance: true,
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
      canManageStock: true,
      canManageFinance: true,
    };
  }

  if (role === 'administrator') {
    return {
      canManagePlatformCompanies: false,
      canManageCompanySettings: false, // Bloqueado de alterar dados fiscais/legais ou excluir empresa
      canManageClients: true,
      canManageEquipments: true,
      canManageTechnicians: false, // Apenas Gestor gerencia equipe e acessos
      canCreateServiceOrder: true,
      canAssignTechnicians: true,
      canViewReports: true,
      canManagePriceCatalog: false, // Catálogo oficial é de responsabilidade do Gestor
      canApproveOrderItems: true,
      canManageStock: true,
      canManageFinance: true,
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
    canManageStock: false,
    canManageFinance: false,
  };
}

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  platform_admin: 'Administrador da Plataforma',
  manager: 'Gestor da Empresa',
  administrator: 'Administrador Operacional',
  technician: 'Técnico de Campo',
};
