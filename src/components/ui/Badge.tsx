import React from 'react';
import type {
  EffectiveRole,
  EquipmentStatus,
  OSPriority,
  OSStatus,
  OSType,
} from '../../types/database';
import { ROLE_LABELS } from '../../lib/permissions';

export const OS_STATUS_META: Record<
  OSStatus,
  { label: string; badgeClass: string; colorHex: string }
> = {
  open: {
    label: 'Aberta',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    colorHex: '#D97706',
  },
  scheduled: {
    label: 'Agendada',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    colorHex: '#0284C7',
  },
  in_progress: {
    label: 'Em Execução',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
    colorHex: '#0D9488',
  },
  completed: {
    label: 'Concluída',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    colorHex: '#059669',
  },
  cancelled: {
    label: 'Cancelada',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
    colorHex: '#64748B',
  },
};

export const OS_PRIORITY_META: Record<
  OSPriority,
  { label: string; badgeClass: string }
> = {
  low: {
    label: 'Baixa',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  medium: {
    label: 'Normal',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  high: {
    label: 'Alta',
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
  },
  urgent: {
    label: 'Urgente',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
};

export const OS_TYPE_LABELS: Record<OSType, string> = {
  preventive: 'Manutenção Preventiva',
  corrective: 'Manutenção Corretiva',
  calibration: 'Calibração / Aferição',
  installation: 'Instalação',
  inspection: 'Vistoria Técnica',
};

export const EQUIPMENT_STATUS_META: Record<
  EquipmentStatus,
  { label: string; badgeClass: string }
> = {
  active: {
    label: 'Em Operação',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  maintenance: {
    label: 'Em Manutenção',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  inactive: {
    label: 'Inativa',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  condemned: {
    label: 'Interditada / Baixada',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
};

export const OSStatusBadge: React.FC<{ status: OSStatus }> = ({ status }) => {
  const meta = OS_STATUS_META[status] ?? OS_STATUS_META.open;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${meta.badgeClass}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: meta.colorHex }}
      />
      {meta.label}
    </span>
  );
};

export const OSPriorityBadge: React.FC<{ priority: OSPriority }> = ({ priority }) => {
  const meta = OS_PRIORITY_META[priority] ?? OS_PRIORITY_META.medium;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${meta.badgeClass}`}
    >
      {meta.label}
    </span>
  );
};

export const EquipmentStatusBadge: React.FC<{ status: EquipmentStatus }> = ({
  status,
}) => {
  const meta = EQUIPMENT_STATUS_META[status] ?? EQUIPMENT_STATUS_META.active;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${meta.badgeClass}`}
    >
      {meta.label}
    </span>
  );
};

export const RoleBadge: React.FC<{ role: EffectiveRole | null }> = ({ role }) => {
  if (!role) return null;
  const styles: Record<EffectiveRole, string> = {
    platform_admin: 'bg-indigo-500/20 text-indigo-100 border-indigo-400/30',
    manager: 'bg-teal-500/20 text-teal-100 border-teal-400/30',
    technician: 'bg-sky-500/20 text-sky-100 border-sky-400/30',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${styles[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
};
