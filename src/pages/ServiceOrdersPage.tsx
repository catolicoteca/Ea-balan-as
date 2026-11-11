import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList,
  Plus,
  Search,
  Eye,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import type {
  OSPriority,
  OSStatus,
  ServiceOrder,
  Technician,
} from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  OSPriorityBadge,
  OSStatusBadge,
  OS_TYPE_LABELS,
} from '../components/ui/Badge';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';
import { NewServiceOrderModal } from '../components/modals/NewServiceOrderModal';
import { ServiceOrderDetailModal } from '../components/modals/ServiceOrderDetailModal';

export const ServiceOrdersPage: React.FC = () => {
  const { activeCompany, permissions, effectiveRole } = useAuthTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const { osId } = useParams<{ osId?: string }>();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OSStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<OSPriority | 'all'>('all');
  const [techFilter, setTechFilter] = useState<string>('all');

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [selectedOSId, setSelectedOSId] = useState<string | null>(
    () => osId || searchParams.get('os')
  );

  useEffect(() => {
    const target = osId || searchParams.get('os');
    if (target) {
      setSelectedOSId(target);
    }
  }, [osId, searchParams]);

  const loadOrders = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);

    const [osRes, techRes] = await Promise.all([
      supabase
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
        .order('created_at', { ascending: false }),
      permissions.canAssignTechnicians
        ? supabase
            .from('technicians')
            .select('*')
            .eq('company_id', activeCompany.id)
            .order('full_name', { ascending: true })
        : Promise.resolve({ data: [] as Technician[], error: null }),
    ]);

    if (osRes.error) {
      setError(translateSupabaseError(osRes.error));
      setOrders([]);
    } else {
      setOrders((osRes.data as unknown as ServiceOrder[]) ?? []);
    }

    setTechnicians((techRes.data as Technician[]) ?? []);
    setLoading(false);
  }, [activeCompany, permissions.canAssignTechnicians]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && o.priority !== priorityFilter) return false;
      if (techFilter !== 'all' && o.primary_technician_id !== techFilter)
        return false;
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.title.toLowerCase().includes(q) ||
        (o.client?.name ?? '').toLowerCase().includes(q) ||
        (o.client?.trade_name ?? '').toLowerCase().includes(q) ||
        (o.equipment?.serial_number ?? '').toLowerCase().includes(q)
      );
    });
  }, [orders, search, statusFilter, priorityFilter, techFilter]);

  const closeDetail = () => {
    setSelectedOSId(null);
    if (osId) {
      navigate('/app/ordens-de-servico', { replace: true });
    } else if (searchParams.has('os')) {
      searchParams.delete('os');
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Ordens de Serviço
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {effectiveRole === 'technician'
              ? 'Listagem das ordens de serviço atribuídas a você.'
              : 'Gestão completa de abertura, triagem, agendamento e atribuição técnica.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            isLoading={loading}
            onClick={() => void loadOrders()}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            Atualizar
          </Button>
          {permissions.canCreateServiceOrder && (
            <Button
              onClick={() => setNewModalOpen(true)}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Nova Ordem de Serviço
            </Button>
          )}
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      <Card noPadding>
        {/* Filtros */}
        <div className="p-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nº OS, cliente, título ou nº de série..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OSStatus | 'all')}
            aria-label="Filtrar por status"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-700"
          >
            <option value="all">Todos os status</option>
            <option value="open">Abertas</option>
            <option value="scheduled">Agendadas</option>
            <option value="in_progress">Em Execução</option>
            <option value="completed">Concluídas</option>
            <option value="cancelled">Canceladas</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value as OSPriority | 'all')
            }
            aria-label="Filtrar por prioridade"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-700"
          >
            <option value="all">Todas as prioridades</option>
            <option value="urgent">Urgente</option>
            <option value="high">Alta</option>
            <option value="medium">Normal</option>
            <option value="low">Baixa</option>
          </select>

          {permissions.canAssignTechnicians && (
            <select
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
              aria-label="Filtrar por técnico"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-700"
            >
              <option value="all">Todos os técnicos</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Consultando ordens de serviço no banco...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-5 h-5" />}
            title="Nenhuma ordem de serviço encontrada"
            description="Ajuste os filtros ou cadastre uma nova ordem de serviço real para esta empresa."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-5">Nº OS</th>
                  <th className="py-3 px-4">Cliente & Título</th>
                  <th className="py-3 px-4">Equipamento</th>
                  <th className="py-3 px-4">Técnico</th>
                  <th className="py-3 px-4">Agendamento</th>
                  <th className="py-3 px-4">Prioridade</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5 text-right">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((os) => (
                  <tr key={os.id} className="hover:bg-slate-50/70">
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
                        {os.client?.trade_name || os.client?.name}
                      </div>
                      <div className="text-[11px] text-slate-500 max-w-xs truncate">
                        {os.title}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      {os.equipment ? (
                        <>
                          <div className="font-medium text-slate-800">
                            {os.equipment.brand} {os.equipment.model}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {os.equipment.serial_number}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
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
                        <span className="text-slate-400">A definir</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap tabular-nums text-slate-600">
                      {os.scheduled_start
                        ? new Date(os.scheduled_start).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Não agendada'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <OSPriorityBadge priority={os.priority} />
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <OSStatusBadge status={os.status} />
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedOSId(os.id)}
                        leftIcon={<Eye className="w-3.5 h-3.5" />}
                      >
                        Ver OS
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewServiceOrderModal
        isOpen={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={() => void loadOrders()}
      />

      <ServiceOrderDetailModal
        osId={selectedOSId}
        onClose={closeDetail}
        onUpdated={() => void loadOrders()}
      />
    </div>
  );
};
