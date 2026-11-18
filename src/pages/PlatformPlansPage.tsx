import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  Plus,
  Check,
  X,
  Sliders,
  Edit2,
  Trash2,
} from 'lucide-react';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { Button } from '../components/ui/Button';
import { PlanModal } from '../components/modals/PlanModal';
import { CompanySubscriptionModal } from '../components/modals/CompanySubscriptionModal';
import { fetchPlans, deletePlan, fetchAllSubscriptions } from '../lib/plans';
import type { Plan, Company, Subscription } from '../types/database';
import { translateSupabaseError } from '../lib/errors';

export const PlatformPlansPage: React.FC = () => {
  const { companies } = useAuthTenant();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<(Subscription & { company_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'plans' | 'subscriptions'>('plans');

  // Modais
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planToEdit, setPlanToEdit] = useState<Plan | null>(null);

  const [subModalOpen, setSubModalOpen] = useState(false);
  const [selectedCompanyForSub, setSelectedCompanyForSub] = useState<Company | null>(null);

  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [fetchedPlans, fetchedSubs] = await Promise.all([
        fetchPlans(),
        fetchAllSubscriptions(),
      ]);
      setPlans(fetchedPlans);
      setSubscriptions(fetchedSubs);
    } catch (err) {
      setActionMsg({ type: 'error', text: translateSupabaseError(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEditPlan = (plan: Plan) => {
    setPlanToEdit(plan);
    setPlanModalOpen(true);
  };

  const handleCreatePlan = () => {
    setPlanToEdit(null);
    setPlanModalOpen(true);
  };

  const handleDeletePlan = async (plan: Plan) => {
    if (!window.confirm(`Deseja realmente excluir o plano "${plan.name}"?`)) return;

    try {
      await deletePlan(plan.id);
      setActionMsg({ type: 'success', text: `Plano "${plan.name}" excluído com sucesso.` });
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: translateSupabaseError(err) });
    }
  };

  const handleManageCompanySub = (company: Company) => {
    setSelectedCompanyForSub(company);
    setSubModalOpen(true);
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">
        Carregando planos e assinaturas da plataforma...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            Planos, Recursos &amp; Assinaturas
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Gerenciamento global de precificação, limites estruturais e concessões por empresa.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleCreatePlan}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Novo Plano
          </Button>
        </div>
      </div>

      {actionMsg && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between ${
            actionMsg.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}
        >
          <span>{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex gap-4">
        <button
          onClick={() => setActiveTab('plans')}
          className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'plans'
              ? 'border-teal-600 text-teal-700 dark:text-teal-400 dark:border-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          Planos Cadastrados ({plans.length})
        </button>
        <button
          onClick={() => setActiveTab('subscriptions')}
          className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'subscriptions'
              ? 'border-teal-600 text-teal-700 dark:text-teal-400 dark:border-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          Assinaturas das Empresas ({companies.length})
        </button>
      </div>

      {/* Conteúdo: Planos Cadastrados */}
      {activeTab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-teal-500/50 transition-colors"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{plan.name}</h2>
                    <span className="text-[10px] text-slate-400 font-mono">slug: {plan.slug}</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      plan.is_active
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {plan.is_active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    R$ {Number(plan.price).toFixed(2).replace('.', ',')}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">/{plan.billing_cycle === 'monthly' ? 'mês' : plan.billing_cycle}</span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed min-h-[36px]">
                  {plan.description || 'Sem descrição cadastrada.'}
                </p>

                {/* Limites Operacionais */}
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-300">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 text-[10px] uppercase tracking-wider mb-1">
                    Limites Operacionais
                  </div>
                  <div className="flex justify-between">
                    <span>Técnicos em campo:</span>
                    <strong className="text-slate-900 dark:text-slate-100">{plan.max_technicians !== null ? `${plan.max_technicians}` : 'Ilimitado'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Colaboradores / Usuários:</span>
                    <strong className="text-slate-900 dark:text-slate-100">{plan.max_users !== null ? `${plan.max_users}` : 'Ilimitado'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Clientes cadastrados:</span>
                    <strong className="text-slate-900 dark:text-slate-100">{plan.max_clients !== null ? `${plan.max_clients}` : 'Ilimitado'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Balanças cadastradas:</span>
                    <strong className="text-slate-900 dark:text-slate-100">{plan.max_equipments !== null ? `${plan.max_equipments}` : 'Ilimitado'}</strong>
                  </div>
                </div>

                {/* Módulos Habilitados */}
                <div className="space-y-1 text-xs">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Recursos Inclusos
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[11px]">
                    <span className={`inline-flex items-center gap-1 ${plan.features?.stock ? 'text-teal-700 dark:text-teal-400' : 'text-slate-400 line-through'}`}>
                      {plan.features?.stock ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} Estoque
                    </span>
                    <span className={`inline-flex items-center gap-1 ${plan.features?.multi_scale_os ? 'text-teal-700 dark:text-teal-400' : 'text-slate-400 line-through'}`}>
                      {plan.features?.multi_scale_os ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} Multi-Balanças
                    </span>
                    <span className={`inline-flex items-center gap-1 ${plan.features?.gps_routing ? 'text-teal-700 dark:text-teal-400' : 'text-slate-400 line-through'}`}>
                      {plan.features?.gps_routing ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} GPS / Waze
                    </span>
                    <span className={`inline-flex items-center gap-1 ${plan.features?.custom_logo ? 'text-teal-700 dark:text-teal-400' : 'text-slate-400 line-through'}`}>
                      {plan.features?.custom_logo ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} White-label
                    </span>
                  </div>
                </div>
              </div>

              {/* Ações */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleEditPlan(plan)}
                  leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                >
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDeletePlan(plan)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Conteúdo: Assinaturas das Empresas */}
      {activeTab === 'subscriptions' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Empresa Assinante</th>
                  <th className="px-4 py-3">Plano Atual</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Valor / Ciclo</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {companies.map((company) => {
                  const sub = subscriptions.find((s) => s.company_id === company.id);
                  const plan = sub?.plan || plans.find((p) => p.slug === 'profissional');

                  return (
                    <tr key={company.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900 dark:text-slate-100">{company.name}</div>
                        <div className="text-[11px] text-slate-400">{company.slug}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {plan?.name || 'Profissional (Padrão)'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            sub?.status === 'active' || !sub
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                              : sub?.status === 'trialing'
                              ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800'
                              : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {sub?.status === 'trialing' ? 'Em Teste' : sub?.status === 'suspended' ? 'Suspensa' : 'Ativa'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 font-mono">
                        R$ {Number(plan?.price || 397).toFixed(2).replace('.', ',')} / mês
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleManageCompanySub(company)}
                          leftIcon={<Sliders className="w-3.5 h-3.5" />}
                        >
                          Alterar / Customizar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modais */}
      <PlanModal
        isOpen={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        onSuccess={loadData}
        planToEdit={planToEdit}
      />

      <CompanySubscriptionModal
        isOpen={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        onSuccess={loadData}
        company={selectedCompanyForSub}
        availablePlans={plans}
      />
    </div>
  );
};
