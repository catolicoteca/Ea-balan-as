import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList,
  CalendarClock,
  PlayCircle,
  CheckCircle2,
  Plus,
  RefreshCw,
  ArrowRight,
  Calendar,
  Wrench,
  Eye,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import type { DashboardStatusCounts, OSStatus, ServiceOrder } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  OSPriorityBadge,
  OSStatusBadge,
  OS_STATUS_META,
  OS_TYPE_LABELS,
} from '../components/ui/Badge';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';
import { NewServiceOrderModal } from '../components/modals/NewServiceOrderModal';
import { ServiceOrderDetailModal } from '../components/modals/ServiceOrderDetailModal';
import { GlobalSearchBar } from '../components/layout/GlobalSearchBar';

const CHART_STATUSES: OSStatus[] = [
  'open',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
];

export const DashboardPage: React.FC = () => {
  const { activeCompany, effectiveRole, permissions, myTechnician } = useAuthTenant();

  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isNewOSOpen, setIsNewOSOpen] = useState<boolean>(false);
  const [selectedOSId, setSelectedOSId] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);

    const { data, error: queryErr } = await supabase
      .from('service_orders')
      .select(
        `
        *,
        client:clients(id, name, trade_name, document_number, phone),
        unit:client_units(id, unit_name, street, street_number, city, state),
        equipment:equipments(id, brand, model, serial_number, capacity_label, asset_tag),
        primary_technician:technicians!fk_os_primary_technician_tenant(id, full_name, calendar_color, phone)
      `
      )
      .eq('company_id', activeCompany.id)
      .order('created_at', { ascending: false });

    if (queryErr) {
      setError(translateSupabaseError(queryErr));
      setOrders([]);
    } else {
      setOrders((data as unknown as ServiceOrder[]) ?? []);
    }
    setLoading(false);
  }, [activeCompany]);

  useEffect(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

  // Indicadores calculados 100% a partir dos registros reais do banco
  const counts = useMemo<DashboardStatusCounts>(() => {
    const base: DashboardStatusCounts = {
      open: 0,
      scheduled: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      total: orders.length,
    };
    for (const o of orders) {
      base[o.status] = (base[o.status] ?? 0) + 1;
    }
    return base;
  }, [orders]);

  // Próximos agendamentos reais dos técnicos
  const upcomingSchedule = useMemo(() => {
    return orders
      .filter(
        (o) =>
          Boolean(o.scheduled_start) &&
          o.status !== 'completed' &&
          o.status !== 'cancelled'
      )
      .sort(
        (a, b) =>
          new Date(a.scheduled_start!).getTime() -
          new Date(b.scheduled_start!).getTime()
      )
      .slice(0, 6);
  }, [orders]);

  const latestOrders = useMemo(() => orders.slice(0, 8), [orders]);

  // Segmentos do gráfico SVG Donut de distribuição por status
  const donutSegments = useMemo(() => {
    if (counts.total === 0) return [];
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    let cumulative = 0;

    return CHART_STATUSES.map((st) => {
      const value = counts[st];
      const fraction = value / counts.total;
      const strokeDasharray = `${fraction * circumference} ${circumference}`;
      const strokeDashoffset = -cumulative * circumference;
      cumulative += fraction;
      return {
        status: st,
        value,
        percentage: Math.round(fraction * 100),
        color: OS_STATUS_META[st].colorHex,
        label: OS_STATUS_META[st].label,
        strokeDasharray,
        strokeDashoffset,
      };
    });
  }, [counts]);

  return (
    <div className="space-y-6">
      {/* Cabeçalho Corporativo do Dashboard */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Painel Operacional — {activeCompany?.name ?? 'EA Balanças'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {effectiveRole === 'technician'
              ? `Visão exclusiva dos atendimentos atribuídos a ${
                  myTechnician?.full_name || 'você'
                } (protegido por RLS).`
              : 'Indicadores em tempo real de ordens de serviço, agenda de campo e parque de pesagem.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="md"
            isLoading={loading}
            onClick={() => void fetchDashboardData()}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            Atualizar
          </Button>

          {permissions.canCreateServiceOrder && (
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsNewOSOpen(true)}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Nova Ordem de Serviço
            </Button>
          )}
        </div>
      </div>

      {/* Barra dedicada de Pesquisa Rápida no Dashboard (Clientes, Equipamentos e OS) */}
      <Card className="!p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs font-medium text-slate-600">
            Consulta Rápida Unificada (Clientes, Balanças/Equipamentos e Ordens de Serviço):
          </div>
          <div className="w-full sm:max-w-md">
            <GlobalSearchBar
              placeholder="Buscar por cliente, nº de série ou OS..."
              onSelectServiceOrder={(id) => setSelectedOSId(id)}
            />
          </div>
        </div>
      </Card>

      {error && <AlertBanner variant="error" message={error} />}

      {/* 4 Indicadores Principais de OS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex items-start justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">OS Abertas</span>
            <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
              {loading ? '—' : counts.open}
            </div>
            <p className="text-[11px] text-amber-700 mt-1 font-medium">
              Aguardando triagem / agendamento
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
            <ClipboardList className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex items-start justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">OS Agendadas</span>
            <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
              {loading ? '—' : counts.scheduled}
            </div>
            <p className="text-[11px] text-sky-700 mt-1 font-medium">
              Atendimento programado em agenda
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
            <CalendarClock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex items-start justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Em Execução</span>
            <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
              {loading ? '—' : counts.in_progress}
            </div>
            <p className="text-[11px] text-teal-700 mt-1 font-medium">
              Técnicos em atendimento no local
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-teal-50 text-teal-600 border border-teal-100">
            <PlayCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex items-start justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">OS Concluídas</span>
            <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
              {loading ? '—' : counts.completed}
            </div>
            <p className="text-[11px] text-emerald-700 mt-1 font-medium">
              Serviços finalizados na empresa
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Linha Central: Gráfico de Distribuição por Status + Agenda dos Técnicos */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Gráfico de Distribuição por Status */}
        <Card
          className="lg:col-span-5"
          title="Distribuição por Status"
          subtitle="Proporção real das ordens de serviço cadastradas"
        >
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Consultando banco de dados...
            </div>
          ) : counts.total === 0 ? (
            <EmptyState
              icon={<ClipboardList className="w-5 h-5" />}
              title="Sem ordens de serviço no momento"
              description="Assim que ordens de serviço reais forem abertas nesta empresa, o gráfico exibirá a distribuição automática por status."
            />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
              <div className="relative w-36 h-36 shrink-0">
                <svg
                  viewBox="0 0 140 140"
                  className="w-full h-full -rotate-90"
                  aria-label="Gráfico de rosca de distribuição de status"
                >
                  <circle
                    cx="70"
                    cy="70"
                    r="54"
                    fill="none"
                    stroke="#F1F5F9"
                    strokeWidth="16"
                  />
                  {donutSegments.map(
                    (seg) =>
                      seg.value > 0 && (
                        <circle
                          key={seg.status}
                          cx="70"
                          cy="70"
                          r="54"
                          fill="none"
                          stroke={seg.color}
                          strokeWidth="16"
                          strokeDasharray={seg.strokeDasharray}
                          strokeDashoffset={seg.strokeDashoffset}
                        />
                      )
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-slate-900 tabular-nums">
                    {counts.total}
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Total de OS
                  </span>
                </div>
              </div>

              <div className="flex-1 w-full space-y-2.5">
                {donutSegments.map((seg) => (
                  <div key={seg.status} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: seg.color }}
                        />
                        {seg.label}
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {seg.value}{' '}
                        <span className="text-slate-400 font-normal">
                          ({seg.percentage}%)
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${seg.percentage}%`,
                          backgroundColor: seg.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Agenda dos Técnicos */}
        <Card
          className="lg:col-span-7"
          title="Agenda dos Técnicos"
          subtitle="Próximos atendimentos técnicos agendados em campo"
          actions={
            <Link
              to="/app/agenda"
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              Ver agenda completa
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Carregando agenda técnica...
            </div>
          ) : upcomingSchedule.length === 0 ? (
            <EmptyState
              icon={<Calendar className="w-5 h-5" />}
              title="Nenhum atendimento agendado"
              description="As ordens de serviço com data e horário de atendimento aparecem automaticamente nesta programação."
              action={
                permissions.canCreateServiceOrder ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsNewOSOpen(true)}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Agendar Nova OS
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {upcomingSchedule.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedOSId(item.id)}
                  className="w-full text-left py-3 first:pt-0 last:pb-0 hover:bg-slate-50/80 rounded-lg px-2 -mx-2 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5"
                      style={{
                        backgroundColor:
                          item.primary_technician?.calendar_color || '#0D9488',
                      }}
                    >
                      {(item.primary_technician?.full_name || 'TC')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-teal-700">
                          {item.order_number}
                        </span>
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {item.client?.trade_name || item.client?.name}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        <Wrench className="w-3 h-3 inline mr-1 text-slate-400" />
                        {item.primary_technician?.full_name ||
                          'Técnico a definir'}{' '}
                        • {item.title}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 sm:flex-col sm:items-end shrink-0 pl-12 sm:pl-0">
                    <span className="text-xs font-semibold text-slate-800 tabular-nums">
                      {new Date(item.scheduled_start!).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <OSStatusBadge status={item.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Tabela de Últimas Ordens de Serviço */}
      <Card
        title="Últimas Ordens de Serviço"
        subtitle="Registros mais recentes consultados diretamente no PostgreSQL (Supabase)"
        noPadding
        actions={
          <Link
            to="/app/ordens-de-servico"
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800"
          >
            Todas as OS
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      >
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Consultando ordens de serviço...
          </div>
        ) : latestOrders.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-5 h-5" />}
            title="Nenhuma ordem de serviço registrada"
            description={
              permissions.canCreateServiceOrder
                ? 'Clique em "Nova Ordem de Serviço" para registrar o primeiro chamado técnico real no banco de dados.'
                : 'Ainda não há ordens de serviço atribuídas ao seu perfil técnico nesta empresa.'
            }
            action={
              permissions.canCreateServiceOrder ? (
                <Button
                  size="sm"
                  onClick={() => setIsNewOSOpen(true)}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  Nova Ordem de Serviço
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-5">Nº OS</th>
                  <th className="py-3 px-4">Cliente / Unidade</th>
                  <th className="py-3 px-4">Balança / Equipamento</th>
                  <th className="py-3 px-4">Técnico</th>
                  <th className="py-3 px-4">Prioridade</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {latestOrders.map((os) => (
                  <tr
                    key={os.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="py-3.5 px-5 whitespace-nowrap">
                      <div className="font-mono font-bold text-slate-900">
                        {os.order_number}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {OS_TYPE_LABELS[os.order_type]}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">
                        {os.client?.trade_name || os.client?.name || '—'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {os.unit
                          ? `${os.unit.unit_name} (${os.unit.city}/${os.unit.state})`
                          : os.title}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      {os.equipment ? (
                        <>
                          <div className="font-medium text-slate-800">
                            {os.equipment.brand} {os.equipment.model}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            S/N: {os.equipment.serial_number}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">Não vinculado</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {os.primary_technician ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor:
                                os.primary_technician.calendar_color || '#0D9488',
                            }}
                          />
                          {os.primary_technician.full_name}
                        </span>
                      ) : (
                        <span className="text-slate-400">Não atribuído</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <OSPriorityBadge priority={os.priority} />
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <OSStatusBadge status={os.status} />
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedOSId(os.id)}
                        leftIcon={<Eye className="w-3.5 h-3.5" />}
                      >
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modais Reutilizáveis */}
      <NewServiceOrderModal
        isOpen={isNewOSOpen}
        onClose={() => setIsNewOSOpen(false)}
        onCreated={() => void fetchDashboardData()}
      />

      <ServiceOrderDetailModal
        osId={selectedOSId}
        onClose={() => setSelectedOSId(null)}
        onUpdated={() => void fetchDashboardData()}
      />
    </div>
  );
};
