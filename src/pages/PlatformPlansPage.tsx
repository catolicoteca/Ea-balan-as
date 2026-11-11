import React from 'react';
import {
  CreditCard,
  Clock,
  Check,
  ShieldAlert,
  Building2,
} from 'lucide-react';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { Card } from '../components/ui/Card';

const PLANNED_TIERS = [
  {
    code: 'essencial',
    name: 'Metrion Essencial',
    description: 'Para pequenas assistências técnicas iniciando o controle digital.',
    limits: 'Até 3 técnicos em campo • Catálogo de peças • Check-in GPS',
    features: [
      'Portal do Gestor (/app) e Portal do Técnico (/tecnico)',
      'Convites via WhatsApp e controle de equipamentos',
      'Checklist metrológico e histórico auditável',
    ],
  },
  {
    code: 'profissional',
    name: 'Metrion Profissional',
    description: 'Ideal para empresas em crescimento com fluxo completo de orçamento.',
    limits: 'Até 15 técnicos em campo • Relatórios PDF • Fotos e assinaturas',
    features: [
      'Tudo do plano Essencial',
      'Armazenamento privado de fotos de lacres e assinaturas',
      'Relatórios de produtividade e aprovação de peças',
    ],
  },
  {
    code: 'enterprise',
    name: 'Metrion Enterprise',
    description: 'Operações regionais ou multi-unidades com suporte dedicado.',
    limits: 'Técnicos ilimitados • Multi-unidades • Auditoria avançada',
    features: [
      'Tudo do plano Profissional',
      'Personalização completa de marca e logotipo',
      'Governança e auditoria estendida de atendimento',
    ],
  },
];

export const PlatformPlansPage: React.FC = () => {
  const { companies } = useAuthTenant();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-teal-700" />
          Planos &amp; Assinaturas Metrion
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Estrutura comercial de referência para comercialização do SaaS Metrion.
        </p>
      </div>

      {/* Aviso explícito e transparente de status */}
      <div className="p-4 rounded-xl border border-sky-200 bg-sky-50/70 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
        <div className="text-xs text-sky-950 space-y-1 leading-relaxed">
          <div className="font-bold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-sky-700" />
            Módulo em Planejamento — Cobrança e Assinaturas Ainda Não Implementadas
          </div>
          <p className="text-sky-900/90">
            Esta tela apresenta a estrutura visual dos planos previstos para o Metrion.{' '}
            <strong>Nenhuma cobrança real, boleto, PIX ou pagamento fictício está ativo</strong> nesta etapa. A criação das tabelas de assinatura e integração com gateway financeiro acontecerá após a definição do provedor de pagamentos.
          </p>
        </div>
      </div>

      {/* Grade de Planos Planejados (Sem valores financeiros inventados) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANNED_TIERS.map((tier) => (
          <div
            key={tier.code}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900">{tier.name}</h2>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">
                  Planejado
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {tier.description}
              </p>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 font-medium">
                {tier.limits}
              </div>
              <div className="text-xs font-semibold text-slate-500 pt-1">
                Valor mensal: <span className="text-slate-700">A definir na integração</span>
              </div>
            </div>

            <ul className="space-y-2 pt-3 border-t border-slate-100 text-xs text-slate-700">
              {tier.features.map((feat) => (
                <li key={feat} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Situação de Assinatura por Empresa (Somente Status Real Atual) */}
      <Card
        title="Status Atual de Acesso das Empresas"
        subtitle="Situação operacional atual no banco enquanto o módulo de assinatura financeira não é ativado"
      >
        <div className="divide-y divide-slate-100 text-xs">
          {companies.map((c) => (
            <div
              key={c.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2.5">
                <Building2 className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="font-bold text-slate-900">{c.name}</span>
                  <span className="ml-2 text-slate-400 font-mono">({c.slug})</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-slate-500">
                  Plano: <strong className="text-slate-700">Não vinculado (Pré-billing)</strong>
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    c.is_active
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {c.is_active ? 'Operação Ativa' : 'Suspensa'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
