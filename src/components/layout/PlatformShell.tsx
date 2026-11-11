import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  Building2,
  CreditCard,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  ArrowUpRight,
  Layers,
} from 'lucide-react';
import { useAuthTenant } from '../../contexts/AuthTenantContext';

interface PlatformNavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

const PLATFORM_NAV_ITEMS: PlatformNavItem[] = [
  {
    to: '/platform',
    label: 'Visão Geral Metrion',
    icon: <LayoutGrid className="w-4 h-4" />,
    end: true,
  },
  {
    to: '/platform/empresas',
    label: 'Empresas Assinantes',
    icon: <Building2 className="w-4 h-4" />,
  },
  {
    to: '/platform/planos',
    label: 'Planos & Assinaturas',
    icon: <CreditCard className="w-4 h-4" />,
  },
];

export const PlatformShell: React.FC = () => {
  const { user, profile, companies, memberships, selectCompany, signOut } =
    useAuthTenant();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = (profile?.full_name || user?.email || 'SA')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  // Empresas em que o Super Admin também tem vínculo legítimo de gestor (ex.: EA Balanças)
  const linkedManagedCompanies = companies.filter((c) =>
    memberships.some((m) => m.company_id === c.id && m.is_active && m.role === 'manager')
  );

  const handleOpenManagedCompany = (companyId: string) => {
    selectCompany(companyId);
    setMobileOpen(false);
    navigate('/app/dashboard');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full text-slate-200 bg-[#091426]">
      {/* Identidade Visual Exclusiva METRION */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-extrabold tracking-wide text-white leading-none">
              METRION
            </div>
            <div className="text-[10px] font-medium text-teal-300 mt-1">
              Administração da Plataforma
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/25">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            Super Admin Global
          </span>
          <span className="text-[10px] text-amber-200/80 font-mono">SAAS</span>
        </div>
      </div>

      {/* Menu Exclusivo da Plataforma */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Gestão do SaaS
        </div>

        {PLATFORM_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`
            }
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}

        {/* Acesso preservado à empresa com vínculo legítimo (ex.: EA Balanças) */}
        {linkedManagedCompanies.length > 0 && (
          <div className="pt-5 mt-5 border-t border-white/10 space-y-2">
            <div className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Minhas Empresas (Gestor)
            </div>
            {linkedManagedCompanies.map((comp) => (
              <button
                key={comp.id}
                type="button"
                onClick={() => handleOpenManagedCompany(comp.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-teal-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">{comp.name}</div>
                  <div className="text-[10px] text-teal-300/80">
                    Abrir painel operacional (/app)
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-teal-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Rodapé Usuário */}
      <div className="p-3 border-t border-white/10 space-y-2">
        <div className="px-2.5 py-2 rounded-lg bg-white/5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
            {initials || 'SA'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-white truncate">
              {profile?.full_name || 'Proprietário Metrion'}
            </div>
            <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sair da Plataforma
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 z-30 shadow-xl">
        {sidebarContent}
      </aside>

      {/* Sidebar Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full shadow-2xl z-10">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Área Principal */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Abrir menu da plataforma"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Metrion SaaS — Central do Proprietário
              </div>
              <div className="text-[11px] text-slate-500 hidden sm:block">
                Gestão multiempresa, estrutura de planos e governança da plataforma
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold border border-slate-200">
              Ambiente /platform
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
