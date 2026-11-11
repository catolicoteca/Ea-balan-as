import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Tag,
  Calendar,
  LogOut,
  UserCheck,
  Shield,
} from 'lucide-react';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import { BrandLogo } from '../ui/BrandLogo';

export const TechnicianShell: React.FC = () => {
  const { user, profile, activeCompany, effectiveRole, signOut } = useAuthTenant();
  const navigate = useNavigate();

  const navItems = [
    {
      to: '/tecnico/ordens',
      label: 'Minhas OS',
      icon: <ClipboardList className="w-5 h-5" />,
    },
    {
      to: '/tecnico/catalogo',
      label: 'Catálogo de Peças',
      icon: <Tag className="w-5 h-5" />,
    },
    {
      to: '/tecnico/agenda',
      label: 'Minha Agenda',
      icon: <Calendar className="w-5 h-5" />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex flex-col text-slate-800">
      {/* Top Header do Portal do Técnico */}
      <header className="sticky top-0 z-40 bg-[#0B2545] text-white shadow-md border-b border-slate-700">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo
              logoUrl={activeCompany?.logo_url}
              name={activeCompany?.name || 'EA Balanças'}
              size="sm"
              variant="light"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">
                  Portal do Técnico
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  Em Campo
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate max-w-[200px] sm:max-w-xs">
                {activeCompany?.name || 'EA Balanças'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Perfil do Técnico */}
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-white">
                {profile?.full_name || user?.email?.split('@')[0]}
              </div>
              <div className="text-[10px] text-teal-300 font-medium flex items-center justify-end gap-1">
                <UserCheck className="w-3 h-3" />
                <span>Técnico Autorizado</span>
              </div>
            </div>

            {/* Alternar para Gestão (se for Gestor testando a visão do técnico) */}
            {effectiveRole !== 'technician' && (
              <button
                onClick={() => navigate('/app/dashboard')}
                title="Voltar ao Painel Administrativo"
                className="text-xs px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-1 transition-colors"
              >
                <Shield className="w-3.5 h-3.5 text-teal-300" />
                <span className="hidden md:inline">Painel Gestor</span>
              </button>
            )}

            {/* Sair */}
            <button
              onClick={() => signOut()}
              title="Encerrar sessão"
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal do Técnico */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 pb-24 md:pb-8">
        <Outlet />
      </main>

      {/* Bottom Bar Mobile-First para Navegação em Campo */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 shadow-lg md:hidden">
        <div className="flex items-center justify-around py-2 px-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-1 px-3 rounded-lg text-[11px] font-semibold transition-all ${
                  isActive
                    ? 'text-teal-700 bg-teal-50 font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`
              }
            >
              <div className="mb-0.5">{item.icon}</div>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Desktop Sub-nav Bar */}
      <div className="hidden md:block fixed bottom-4 right-4 z-30">
        <div className="bg-slate-900 text-white px-3 py-1.5 rounded-full text-xs shadow-xl flex items-center gap-2 border border-slate-700">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Ambiente de Campo do Técnico</span>
        </div>
      </div>
    </div>
  );
};
