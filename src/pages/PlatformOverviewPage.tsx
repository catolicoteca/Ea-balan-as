import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  Ban,
  CreditCard,
  Layers,
  ArrowUpRight,
  TrendingUp,
} from 'lucide-react';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { Button } from '../components/ui/Button';
import { fetchPlans, fetchAllSubscriptions } from '../lib/plans';
import type { Plan, Subscription } from '../types/database';

export const PlatformOverviewPage: React.FC = () => {
  const { companies, memberships, selectCompany } = useAuthTenant();
  const navigate = useNavigate();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchPlans(), fetchAllSubscriptions()])
      .then(([p, s]) => {
        setPlans(p);
        setSubscriptions(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const activeCount = companies.filter((c) => c.is_active).length;
  const suspendedCount = companies.filter((c) => !c.is_active).length;

  // Calcula MRR Projetado
  const projectedMrr = companies.reduce((total, company) => {
    if (!company.is_active) return total;
    const sub = subscriptions.find((s) => s.company_id === company.id);
    const plan = sub?.plan || plans.find((p) => p.slug === 'profissional');
    return total + (plan ? Number(plan.price) : 397);
  }, 0);

  const isLinkedManager = (companyId: string) =>
    memberships.some(
      (m) => m.company_id === companyId && m.is_active && m.role === 'manager'
    );

  const handleOpenCompany = (companyId: string) => {
    selectCompany(companyId);
    navigate('/app/dashboard');
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">
        Carregando métricas e indicadores de planos da plataforma...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            Visão Geral da Plataforma Metrion
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Painel administrativo global independente para controle comercial, planos e empresas assinantes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/platform/planos">
            <Button size="sm" variant="outline" leftIcon={<CreditCard className="w-4 h-4" />}>
              Planos &amp; Limites
            </Button>
          </Link>
          <Link to="/platform/empresas">
            <Button size="sm" variant="primary" leftIcon={<Building2 className="w-4 h-4" />}>
              Gerenciar Empresas ({companies.length})
            </Button>
          </Link>
        </div>
      </div>

      {/* Indicadores Comerciais e Operacionais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Total de Empresas</span>
            <Building2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2">{companies.length}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Tenants isolados por RLS
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Empresas Ativas</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-2">{activeCount}</div>
          <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-1">
            Operação habilitada
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Receita Recorrente (MRR)</span>
            <TrendingUp className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          </div>
          <div className="text-2xl font-bold text-teal-700 dark:text-teal-400 mt-2">
            R$ {projectedMrr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-teal-700/80 dark:text-teal-400/80 mt-1">
            Projeção mensal por assinaturas
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Empresas Suspensas</span>
            <Ban className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-2">{suspendedCount}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Acesso bloqueado
          </div>
        </div>
      </div>

      {/* Empresas Cadastradas */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Empresas Assinantes no SaaS
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cada empresa opera com isolamento multi-tenant restrito por Row Level Security.
            </p>
          </div>
          <Link to="/platform/empresas">
            <Button size="sm" variant="outline">
              Ver Todas
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {companies.map((c) => {
            const sub = subscriptions.find((s) => s.company_id === c.id);
            const plan = sub?.plan || plans.find((p) => p.slug === 'profissional');

            return (
              <div
                key={c.id}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {c.name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        c.is_active
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                      }`}
                    >
                      {c.is_active ? 'Ativa' : 'Suspensa'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {c.slug}
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                    <CreditCard className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                    {plan?.name || 'Metrion Profissional'}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">
                    {c.document_cnpj || 'CNPJ não informado'}
                  </span>
                  {isLinkedManager(c.id) && (
                    <button
                      type="button"
                      onClick={() => handleOpenCompany(c.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                    >
                      Operar Gestão <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
