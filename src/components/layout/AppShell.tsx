import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Scale,
  Wrench,
  ClipboardList,
  Calendar,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
  Building,
  ChevronDown,
  Tag,
  Layers,
} from 'lucide-react';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import { BrandLogo } from '../ui/BrandLogo';
import { RoleBadge } from '../ui/Badge';
import { GlobalSearchBar } from './GlobalSearchBar';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  allowTechnician: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/app/dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-4 h-4" />,
    allowTechnician: true,
  },
  {
    to: '/app/clientes',
    label: 'Clientes',
    icon: <Users className="w-4 h-4" />,
    allowTechnician: true,
  },
  {
    to: '/app/equipamentos',
    label: 'Balanças / Equipamentos',
    icon: <Scale className="w-4 h-4" />,
    allowTechnician: true,
  },
  {
    to: '/app/tecnicos',
    label: 'Técnicos',
    icon: <Wrench className="w-4 h-4" />,
    allowTechnician: false,
  },
  {
    to: '/app/ordens-de-servico',
    label: 'Ordens de Serviço',
    icon: <ClipboardList className="w-4 h-4" />,
    allowTechnician: true,
  },
  {
    to: '/app/tabela-precos',
    label: 'Tabela de Preços',
    icon: <Tag className="w-4 h-4" />,
    allowTechnician: true,
  },
  {
    to: '/app/agenda',
    label: 'Agenda',
    icon: <Calendar className="w-4 h-4" />,
    allowTechnician: true,
  },
  {
    to: '/app/relatorios',
    label: 'Relatórios',
    icon: <BarChart3 className="w-4 h-4" />,
    allowTechnician: false,
  },
  {
    to: '/app/configuracoes',
    label: 'Configurações',
    icon: <Settings className="w-4 h-4" />,
    allowTechnician: false,
  },
];

export const AppShell: React.FC = () => {
  const {
    user,
    profile,
    companies,
    memberships,
    isPlatformAdmin,
    activeCompany,
    effectiveRole,
    selectCompany,
    signOut,
  } = useAuthTenant();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);

  const memberCompanies = companies.filter((c) =>
    memberships.some((m) => m.company_id === c.id && m.is_active)
  );

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => effectiveRole !== 'technician' || item.allowTechnician
  );

  const sidebarBg = activeCompany?.sidebar_color || '#0B2545';
  const primaryColor = activeCompany?.primary_color || '#0D9488';

  const SidebarContent = () => (
    <div
      className="flex flex-col h-full text-slate-100 select-none"
      style={{ backgroundColor: sidebarBg }}
    >
      {/* Topo: Identidade Visual da Empresa */}
      <div className="px-5 py-5 border-b border-white/10">
        <BrandLogo
          name={activeCompany?.name || 'EA Balanças'}
          logoUrl={activeCompany?.logo_url}
          primaryColor={primaryColor}
          variant="dark"
        />

        {/* Seletor restrito às empresas em que o usuário possui vínculo ativo */}
        {memberCompanies.length > 1 && (
          <div className="mt-4">
            <label className="block text-[10px] uppercase tracking-wider text-slate-300/75 font-semibold mb-1">
              Empresa ativa (Multi-tenant)
            </label>
            <div className="relative">
              <Building className="w-3.5 h-3.5 text-slate-300 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={activeCompany?.id ?? ''}
                onChange={(e) => selectCompany(e.target.value)}
                aria-label="Selecionar empresa ativa"
                className="w-full appearance-none pl-8 pr-7 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                {memberCompanies.map((c) => (
                  <option key={c.id} value={c.id} className="text-slate-900 bg-white">
                    {c.name} {!c.is_active ? '(Inativa)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-300 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <RoleBadge role={isPlatformAdmin ? 'manager' : effectiveRole} />
          {effectiveRole === 'technician' && (
            <span className="text-[10px] text-slate-300/80">Acesso restrito</span>
          )}
        </div>

        {isPlatformAdmin && (
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              navigate('/platform');
            }}
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-[11px] font-semibold text-amber-200 transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-amber-300" />
            Painel Metrion (/platform)
          </button>
        )}
      </div>

      {/* Menu de Módulos */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Módulos do Sistema
        </div>
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-white/12 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-white/8 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
                    style={{ backgroundColor: primaryColor }}
                  />
                )}
                <span
                  className="shrink-0 transition-colors"
                  style={isActive ? { color: '#2DD4BF' } : undefined}
                >
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Rodapé do Usuário */}
      <div className="p-4 border-t border-white/10 bg-black/15">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">
              {profile?.full_name || user?.email?.split('@')[0] || 'Usuário'}
            </div>
            <div className="text-[11px] text-slate-300/75 truncate">
              {user?.email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sair do sistema"
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F4F7FA]">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 z-30 shadow-xl">
        <SidebarContent />
      </aside>

      {/* Drawer Mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10 shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar menu"
              className="absolute top-4 right-3 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 z-20"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Área Principal */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0">
        {/* Topbar Corporativa */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200/90 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu de navegação"
              className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>

            <GlobalSearchBar />
          </div>

          <div className="hidden sm:flex items-center gap-3 shrink-0">
            {activeCompany && (
              <div className="text-right">
                <div className="text-xs font-semibold text-slate-800">
                  {activeCompany.name}
                </div>
                <div className="text-[11px] text-slate-500">
                  {activeCompany.document_cnpj || 'Ambiente Multi-tenant Seguro'}
                </div>
              </div>
            )}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              {(profile?.full_name || user?.email || 'EA')
                .slice(0, 2)
                .toUpperCase()}
            </div>
          </div>
        </header>

        {/* Conteúdo da Página */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
