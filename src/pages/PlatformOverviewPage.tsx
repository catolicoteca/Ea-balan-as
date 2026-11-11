import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  Ban,
  CreditCard,
  ShieldAlert,
  ArrowRight,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export const PlatformOverviewPage: React.FC = () => {
  const { companies, memberships, selectCompany } = useAuthTenant();
  const navigate = useNavigate();

  const activeCount = companies.filter((c) => c.is_active).length;
  const suspendedCount = companies.filter((c) => !c.is_active).length;

  const isLinkedManager = (companyId: string) =>
    memberships.some(
      (m) => m.company_id === companyId && m.is_active && m.role === 'manager'
    );

  const handleOpenCompany = (companyId: string) => {
    selectCompany(companyId);
    navigate('/app/dashboard');
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-teal-700" />
            Visão Geral da Plataforma Metrion
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Painel administrativo global separado da operação individual de clientes e ordens de serviço.
          </p>
        </div>

        <Link to="/platform/empresas">
          <Button size="sm" leftIcon={<Building2 className="w-4 h-4" />}>
            Gerenciar Empresas ({companies.length})
          </Button>
        </Link>
      </div>

      {/* Indicadores Reais de Empresas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Total de Empresas</span>
            <Building2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{companies.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Tenants isolados por RLS
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Empresas Ativas</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-2">{activeCount}</div>
          <div className="text-[11px] text-emerald-700/80 mt-1">
            Operação habilitada
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Empresas Suspensas</span>
            <Ban className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-bold text-red-600 mt-2">{suspendedCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Acesso operacional bloqueado
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-4">
          <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
            <span>Receita Recorrente (MRR)</span>
            <CreditCard className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-sm font-bold text-slate-800 mt-2">
            Não configurado
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Aguardando integração financeira na etapa de cobrança.
          </div>
        </div>
      </div>

      {/* Aviso Transparente sobre Cobrança e Fase B */}
      <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-950 space-y-1 leading-relaxed">
          <div className="font-bold">
            Arquitetura em Construção — Fase A Concluída (Separação de Ambientes)
          </div>
          <p className="text-amber-900/90">
            Os módulos de <strong>Planos, Assinaturas, Inadimplência e Suporte Auditado</strong> estão
            estruturados visualmente para governança do Metrion. Nenhuma cobrança fictícia foi gerada e as tabelas financeiras serão criadas apenas após a autorização da <strong>Fase B</strong> e definição do provedor de pagamento.
          </p>
        </div>
      </div>

      {/* Lista Rápida de Empresas Cadastradas */}
      <Card
        title="Empresas Assinantes na Plataforma"
        subtitle="Visão administrativa global sem mistura com dados internos de clientes ou ordens de serviço"
        actions={
          <Link
            to="/platform/empresas"
            className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1"
          >
            Ver todas <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      >
        {companies.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">
            Nenhuma empresa cadastrada na plataforma ainda.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {companies.map((c) => {
              const linked = isLinkedManager(c.id);
              return (
                <div
                  key={c.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: c.sidebar_color }}
                    >
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        {c.name}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            c.is_active
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {c.is_active ? 'Ativa' : 'Suspensa'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        slug: {c.slug} {c.document_cnpj ? `• CNPJ: ${c.document_cnpj}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {linked ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenCompany(c.id)}
                        leftIcon={<ArrowUpRight className="w-3.5 h-3.5" />}
                      >
                        Administrar Empresa (/app)
                      </Button>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic px-2">
                        Suporte auditado previsto na Fase B
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
