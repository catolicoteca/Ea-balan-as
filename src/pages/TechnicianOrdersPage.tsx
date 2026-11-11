import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ClipboardList,
  Search,
  MapPin,
  Calendar,
  Scale,
  ChevronRight,
  Tag,
  AlertCircle,
  RefreshCw,
  Navigation,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import {
  getChecklistProgress,
  parseExecutionMetadata,
} from '../lib/fieldExecution';
import type { ServiceOrder, ServiceOrderExecution } from '../types/database';
import { OSPriorityBadge, OSStatusBadge } from '../components/ui/Badge';
import { ServiceOrderDetailModal } from '../components/modals/ServiceOrderDetailModal';

type TechnicianServiceOrder = ServiceOrder & {
  executions?: Pick<
    ServiceOrderExecution,
    'id' | 'started_at' | 'checkin_latitude' | 'checkin_longitude' | 'calibration_measurements' | 'diagnosis'
  >[];
};

export const TechnicianOrdersPage: React.FC = () => {
  const { activeCompany } = useAuthTenant();
  const navigate = useNavigate();
  const { osId } = useParams<{ osId?: string }>();

  const [orders, setOrders] = useState<TechnicianServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [selectedOSId, setSelectedOSId] = useState<string | null>(() => osId || null);

  useEffect(() => {
    if (osId) {
      setSelectedOSId(osId);
    }
  }, [osId]);

  const loadTechnicianOrders = async () => {
    if (!activeCompany) return;
    setLoading(true);

    try {
      // O RLS do Supabase já filtra apenas as OSs atribuídas a este técnico
      const { data, error } = await supabase
        .from('service_orders')
        .select(`
          *,
          client:clients(id, name, trade_name, document_number, phone),
          unit:client_units(id, unit_name, street, street_number, city, state),
          equipment:equipments(id, brand, model, serial_number, capacity_label, asset_tag),
          executions:service_order_executions(id, started_at, checkin_latitude, checkin_longitude, calibration_measurements, diagnosis)
        `)
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setOrders(data as unknown as TechnicianServiceOrder[]);
      }
    } catch (err) {
      console.warn('Erro ao carregar OS do técnico:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTechnicianOrders();
  }, [activeCompany]);

  const filteredOrders = orders.filter((os) => {
    if (statusFilter === 'pending' && !['open', 'scheduled'].includes(os.status)) return false;
    if (statusFilter === 'in_progress' && os.status !== 'in_progress') return false;
    if (statusFilter === 'completed' && os.status !== 'completed') return false;

    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const inNum = String(os.order_number).includes(q);
    const inTitle = os.title.toLowerCase().includes(q);
    const inClient = (os.client?.trade_name || os.client?.name || '').toLowerCase().includes(q);
    const inModel = (os.equipment?.model || '').toLowerCase().includes(q);
    return inNum || inTitle || inClient || inModel;
  });

  return (
    <div className="space-y-4">
      {/* Header com Acesso Rápido */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-teal-700" />
            Minhas Ordens de Serviço
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Atendimentos em campo atribuídos a você na {activeCompany?.name || 'EA Balanças'}.
          </p>
        </div>

        <button
          onClick={() => navigate('/tecnico/catalogo')}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition-colors self-start sm:self-auto"
        >
          <Tag className="w-4 h-4" />
          <span>Consultar Tabela de Preços</span>
        </button>
      </div>

      {/* Barra de Busca e Filtros Rápidos */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nº da OS, cliente ou modelo da balança..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-full font-medium ${
              statusFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todas ({orders.length})
          </button>
          <button
            onClick={() => setStatusFilter('in_progress')}
            className={`px-3 py-1 rounded-full font-medium ${
              statusFilter === 'in_progress'
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Em Atendimento ({orders.filter((o) => o.status === 'in_progress').length})
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1 rounded-full font-medium ${
              statusFilter === 'pending'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Pendentes / Agendadas ({orders.filter((o) => ['open', 'scheduled'].includes(o.status)).length})
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1 rounded-full font-medium ${
              statusFilter === 'completed'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Concluídas ({orders.filter((o) => o.status === 'completed').length})
          </button>
        </div>
      </div>

      {/* Lista de Ordens de Serviço */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-xs">
          <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-teal-600" />
          Carregando atendimentos...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
          <AlertCircle className="w-8 h-8 mx-auto text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">Nenhum atendimento encontrado</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {search
              ? 'Tente ajustar os termos da pesquisa.'
              : 'Você não possui ordens de serviço pendentes no momento.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((os) => (
            <div
              key={os.id}
              onClick={() => setSelectedOSId(os.id)}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:border-teal-500 hover:shadow-md transition-all cursor-pointer space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                      OS #{os.order_number}
                    </span>
                    <OSStatusBadge status={os.status} />
                    <OSPriorityBadge priority={os.priority} />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900 leading-snug">
                    {os.title}
                  </h2>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
              </div>

              {/* Cliente e Balança */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                <div className="space-y-0.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Cliente / Local
                  </div>
                  <div className="font-medium text-slate-800 truncate">
                    {os.client?.trade_name || os.client?.name || 'Cliente'}
                  </div>
                  {os.unit && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">
                        {os.unit.unit_name} — {os.unit.city}/{os.unit.state}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-0.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Equipamento
                  </div>
                  {os.equipment ? (
                    <div className="font-medium text-slate-800 flex items-center gap-1 truncate">
                      <Scale className="w-3 h-3 text-teal-600 shrink-0" />
                      <span>{os.equipment.brand} {os.equipment.model}</span>
                      <span className="text-slate-400 font-mono text-[10px]">
                        ({os.equipment.serial_number})
                      </span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 italic">
                      Equipamento a identificar em campo
                    </div>
                  )}
                  {os.scheduled_start && (
                    <div className="text-[11px] text-sky-800 font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>
                        {new Date(os.scheduled_start).toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
                {(() => {
                  const exec = os.executions?.[0];
                  const meta = exec
                    ? parseExecutionMetadata(exec.calibration_measurements)
                    : null;
                  const checklistProg = meta
                    ? getChecklistProgress(meta.checklist)
                    : null;

                  if (meta?.arrived_at) {
                    return (
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          No local
                        </span>
                        {checklistProg && checklistProg.answered > 0 && (
                          <span className="text-slate-600 font-medium">
                            Checklist: {checklistProg.answered}/{checklistProg.total}
                          </span>
                        )}
                      </div>
                    );
                  }

                  if (meta?.travel_started_at) {
                    return (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[11px] font-semibold border border-sky-200">
                        <Navigation className="w-3 h-3" />
                        Em deslocamento
                      </span>
                    );
                  }

                  return (
                    <span className="flex items-center gap-1 text-teal-700 font-semibold">
                      <Tag className="w-3.5 h-3.5" />
                      Check-in, Checklist &amp; Peças
                    </span>
                  );
                })()}
                <span className="text-[11px] text-slate-400 font-medium">
                  Toque para abrir atendimento →
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Completo de Atendimento e Peças da OS */}
      <ServiceOrderDetailModal
        osId={selectedOSId}
        onClose={() => {
          setSelectedOSId(null);
          if (osId) {
            navigate('/tecnico/ordens', { replace: true });
          }
        }}
        onUpdated={() => void loadTechnicianOrders()}
      />
    </div>
  );
};
