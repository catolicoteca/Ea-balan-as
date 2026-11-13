import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthTenantProvider, useAuthTenant } from './contexts/AuthTenantContext';
import {
  canAccessManagerAppArea,
  canAccessPlatformArea,
  getDefaultHomeRoute,
} from './lib/routes';
import { PlatformShell } from './components/layout/PlatformShell';
import { AppShell } from './components/layout/AppShell';
import { TechnicianShell } from './components/layout/TechnicianShell';
import { MustChangePasswordModal } from './components/modals/MustChangePasswordModal';
import { AuthPage } from './pages/AuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ActivateAccountPage } from './pages/ActivateAccountPage';
import { PlatformOverviewPage } from './pages/PlatformOverviewPage';
import { PlatformCompaniesPage } from './pages/PlatformCompaniesPage';
import { PlatformPlansPage } from './pages/PlatformPlansPage';
import { DashboardPage } from './pages/DashboardPage';
import { ClientsPage } from './pages/ClientsPage';
import { EquipmentsPage } from './pages/EquipmentsPage';
import { TechniciansPage } from './pages/TechniciansPage';
import { ServiceOrdersPage } from './pages/ServiceOrdersPage';
import { SchedulePage } from './pages/SchedulePage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PriceCatalogPage } from './pages/PriceCatalogPage';
import { TechnicianOrdersPage } from './pages/TechnicianOrdersPage';

const AppRoutes: React.FC = () => {
  const location = useLocation();
  const {
    user,
    profile,
    isLoading,
    schemaMissing,
    isPlatformAdmin,
    companies,
    memberships,
    activeCompany,
    effectiveRole,
    refreshTenantContext,
  } = useAuthTenant();

  // Rota pública de ativação de convite de técnico
  if (location.pathname === '/ativar' || location.pathname === '/ativar-conta') {
    return <ActivateAccountPage />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="w-7 h-7 animate-spin text-teal-700" />
        <span className="text-xs font-medium">
          Validando sessão e permissões multi-tenant...
        </span>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  if (
    schemaMissing ||
    (!isPlatformAdmin && (!activeCompany || !effectiveRole)) ||
    (isPlatformAdmin && companies.length === 0)
  ) {
    return <OnboardingPage />;
  }

  const defaultHome = getDefaultHomeRoute(isPlatformAdmin, effectiveRole);
  const hasActiveCompanyMembership = Boolean(
    activeCompany &&
      memberships.some((m) => m.company_id === activeCompany.id && m.is_active)
  );
  const isPureTechnician = effectiveRole === 'technician' && !isPlatformAdmin;

  const allowPlatform = canAccessPlatformArea(isPlatformAdmin);
  const allowManagerApp = canAccessManagerAppArea(
    isPlatformAdmin,
    effectiveRole,
    hasActiveCompanyMembership
  );

  return (
    <>
      {profile?.must_change_password && (
        <MustChangePasswordModal onSuccess={refreshTenantContext} />
      )}
      <Routes>
      {/* Raiz redireciona sempre para o ambiente padrão do perfil */}
      <Route path="/" element={<Navigate to={defaultHome} replace />} />

      {/* ==================================================================== */}
      {/* 1. SUPER ADMIN METRION (/platform) — Acesso estrito a isPlatformAdmin */}
      {/* ==================================================================== */}
      <Route
        path="/platform"
        element={
          allowPlatform ? (
            <PlatformShell />
          ) : (
            <Navigate to={defaultHome} replace />
          )
        }
      >
        <Route index element={<PlatformOverviewPage />} />
        <Route path="overview" element={<PlatformOverviewPage />} />
        <Route path="empresas" element={<PlatformCompaniesPage />} />
        <Route path="planos" element={<PlatformPlansPage />} />
        <Route path="*" element={<Navigate to="/platform" replace />} />
      </Route>

      {/* ==================================================================== */}
      {/* 2. GESTOR DA EMPRESA (/app) — Bloqueia técnicos, isola empresas      */}
      {/* ==================================================================== */}
      <Route
        path="/app"
        element={
          allowManagerApp ? (
            <AppShell />
          ) : (
            <Navigate to={defaultHome} replace />
          )
        }
      >
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="equipamentos" element={<EquipmentsPage />} />
        <Route path="tecnicos" element={<TechniciansPage />} />
        <Route path="ordens-de-servico" element={<ServiceOrdersPage />} />
        <Route path="tabela-precos" element={<PriceCatalogPage />} />
        <Route path="agenda" element={<SchedulePage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Route>

      {/* ==================================================================== */}
      {/* 3. PORTAL DO TÉCNICO (/tecnico) — Mobile-first de Campo              */}
      {/* ==================================================================== */}
      <Route path="/tecnico" element={<TechnicianShell />}>
        <Route index element={<Navigate to="/tecnico/ordens" replace />} />
        <Route path="ordens" element={<TechnicianOrdersPage />} />
        <Route path="catalogo" element={<PriceCatalogPage />} />
        <Route path="tabela-precos" element={<PriceCatalogPage />} />
        <Route path="agenda" element={<SchedulePage />} />
        <Route path="os/:osId" element={<TechnicianOrdersPage />} />
      </Route>

      {/* ==================================================================== */}
      {/* 4. REDIRECIONAMENTOS DE COMPATIBILIDADE (Links Antigos)             */}
      {/* ==================================================================== */}
      <Route
        path="/dashboard"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/ordens' : '/app/dashboard'}
            replace
          />
        }
      />
      <Route
        path="/clientes"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/ordens' : '/app/clientes'}
            replace
          />
        }
      />
      <Route
        path="/equipamentos"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/ordens' : '/app/equipamentos'}
            replace
          />
        }
      />
      <Route
        path="/tecnicos"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/ordens' : '/app/tecnicos'}
            replace
          />
        }
      />
      <Route
        path="/ordens-de-servico"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/ordens' : '/app/ordens-de-servico'}
            replace
          />
        }
      />
      <Route
        path="/tabela-precos"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/tabela-precos' : '/app/tabela-precos'}
            replace
          />
        }
      />
      <Route
        path="/agenda"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/agenda' : '/app/agenda'}
            replace
          />
        }
      />
      <Route
        path="/relatorios"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/ordens' : '/app/relatorios'}
            replace
          />
        }
      />
      <Route
        path="/configuracoes"
        element={
          <Navigate
            to={isPureTechnician ? '/tecnico/ordens' : '/app/configuracoes'}
            replace
          />
        }
      />

      {/* Fallback Global */}
      <Route path="*" element={<Navigate to={defaultHome} replace />} />
    </Routes>
    </>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthTenantProvider>
        <AppRoutes />
      </AuthTenantProvider>
    </BrowserRouter>
  );
};

export default App;
