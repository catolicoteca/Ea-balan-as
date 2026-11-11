import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, MapPin, Plus, Scale, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import type { ServiceOrder, Technician } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { OSPriorityBadge, OSStatusBadge } from '../components/ui/Badge';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';
import { NewServiceOrderModal } from '../components/modals/NewServiceOrderModal';
import { ServiceOrderDetailModal } from '../components/modals/ServiceOrderDetailModal';

export const SchedulePage: React.FC = () => {
  const { activeCompany, permissions } = useAuthTenant();

  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechId, setSelectedTechId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newOSOpen, setNewOSOpen] = useState(false);
  const [selectedOSId, setSelectedOSId] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);

    const [osRes, techRes] = await Promise.all([
      supabase
        .from('service_orders')
        .select(
          `
          *,
          client:clients(id, name, trade_name),
          unit:client_units(id, unit_name, street, street_number, city, state),
          equipment:equipments(id, brand, model, serial_number),
          primary_technician:technicians!fk_os_primary_technician_tenant(id, full_name, calendar_color)
        `
        )
        .eq('company_id', activeCompany.id)
        .not('scheduled_start', 'is', null)
        .neq('status', 'cancelled')
        .order('scheduled_start', { ascending: true }),
      permissions.canAssignTechnicians
        ? supabase
            .from('technicians')
            .select('*')
            .eq('company_id', activeCompany.id)
            .eq('is_active', true)
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
    void loadSchedule();
  }, [loadSchedule]);

  const groupedByDate = useMemo(() => {
    const filtered = orders.filter(
      (o) =>
        selectedTechId === 'all' || o.primary_technician_id === selectedTechId
    );
    const groups: Record<string, ServiceOrder[]> = {};

    for (const o of filtered) {
      if (!o.scheduled_start) continue;
      const dayKey = new Date(o.scheduled_start).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(o);
    }

    return Object.entries(groups);
  }, [orders, selectedTechId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Agenda Técnica
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Cronograma de visitas, calibrações periódicas e manutenções agendadas em campo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {permissions.canAssignTechnicians && technicians.length > 0 && (
            <select
              value={selectedTechId}
              onChange={(e) => setSelectedTechId(e.target.value)}
              aria-label="Filtrar agenda por técnico"
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

          {permissions.canCreateServiceOrder && (
            <Button
              onClick={() => setNewOSOpen(true)}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Agendar Atendimento
            </Button>
          )}
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {loading ? (
        <Card>
          <div className="py-12 text-center text-xs text-slate-400">
            Consultando agenda no banco de dados...
          </div>
        </Card>
      ) : groupedByDate.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Calendar className="w-5 h-5" />}
            title="Nenhum compromisso agendado"
            description="Defina a data e horário de início em uma Ordem de Serviço para que ela seja organizada nesta agenda."
            action={
              permissions.canCreateServiceOrder ? (
                <Button
                  size="sm"
                  onClick={() => setNewOSOpen(true)}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  Criar OS Agendada
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groupedByDate.map(([dateLabel, dayOrders]) => (
            <Card key={dateLabel} title={dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {dayOrders.map((os) => (
                  <button
                    key={os.id}
                    type="button"
                    onClick={() => setSelectedOSId(os.id)}
                    className="text-left p-4 rounded-xl border border-slate-200 hover:border-teal-500/60 hover:shadow-sm transition-all flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs font-bold text-teal-700">
                          {os.order_number}
                        </span>
                        <h3 className="text-sm font-semibold text-slate-900 mt-0.5">
                          {os.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <OSPriorityBadge priority={os.priority} />
                        <OSStatusBadge status={os.status} />
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-slate-600">
                      <div className="font-medium text-slate-800">
                        {os.client?.trade_name || os.client?.name}
                      </div>
                      {os.unit && (
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>
                            {os.unit.unit_name} — {os.unit.city}/{os.unit.state}
                          </span>
                        </div>
                      )}
                      {os.equipment && (
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Scale className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>
                            {os.equipment.brand} {os.equipment.model} (S/N:{' '}
                            {os.equipment.serial_number})
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                        <Wrench className="w-3.5 h-3.5 text-teal-600" />
                        {os.primary_technician?.full_name || 'Técnico a definir'}
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {new Date(os.scheduled_start!).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {os.scheduled_end &&
                          ` – ${new Date(os.scheduled_end).toLocaleTimeString(
                            'pt-BR',
                            { hour: '2-digit', minute: '2-digit' }
                          )}`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewServiceOrderModal
        isOpen={newOSOpen}
        onClose={() => setNewOSOpen(false)}
        onCreated={() => void loadSchedule()}
        defaultScheduledDate={new Date().toISOString().slice(0, 10)}
      />

      <ServiceOrderDetailModal
        osId={selectedOSId}
        onClose={() => setSelectedOSId(null)}
        onUpdated={() => void loadSchedule()}
      />
    </div>
  );
};
