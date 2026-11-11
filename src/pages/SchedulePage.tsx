import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  List,
  MapPin,
  Plus,
  Scale,
  Wrench,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import {
  detectHorizontalMonthSwipe,
  formatDateKeyLocal,
  getMonthGridDays,
  isDraggableServiceOrder,
  shiftScheduledRangeToDate,
  toLocalDateKey,
} from '../lib/scheduleCalendar';
import type { OSStatus, ServiceOrder, Technician } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { OSPriorityBadge, OSStatusBadge } from '../components/ui/Badge';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';
import { NewServiceOrderModal } from '../components/modals/NewServiceOrderModal';
import { ServiceOrderDetailModal } from '../components/modals/ServiceOrderDetailModal';

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const STATUS_FILTER_OPTIONS: Array<{ value: 'all' | OSStatus; label: string }> = [
  { value: 'all', label: 'Todos os status' },
  { value: 'open', label: 'Aberta' },
  { value: 'scheduled', label: 'Agendada' },
  { value: 'in_progress', label: 'Em Execução' },
  { value: 'completed', label: 'Concluída' },
];

interface PendingMoveState {
  order: ServiceOrder;
  targetDateKey: string;
}

export const SchedulePage: React.FC = () => {
  const { activeCompany, permissions } = useAuthTenant();

  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechId, setSelectedTechId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | OSStatus>('all');
  const [viewMode, setViewMode] = useState<'month' | 'list'>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Estado do calendário mensal (mês visível e dia selecionado)
  const today = useMemo(() => new Date(), []);
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() =>
    formatDateKeyLocal(today)
  );

  // Modais de criação/visualização de OS
  const [newOSOpen, setNewOSOpen] = useState(false);
  const [newOSDefaultDate, setNewOSDefaultDate] = useState<string>(() =>
    formatDateKeyLocal(today)
  );
  const [selectedOSId, setSelectedOSId] = useState<string | null>(null);

  // Drag & Drop / Reagendamento
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [dragOverDateKey, setDragOverDateKey] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMoveState | null>(null);
  const [mobileMoveDate, setMobileMoveDate] = useState<string>('');
  const [mobileMoveOrder, setMobileMoveOrder] = useState<ServiceOrder | null>(null);
  const [savingMove, setSavingMove] = useState(false);

  // Gesto horizontal no celular
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMsg]);

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

  // Filtra OS por técnico e status
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (selectedTechId !== 'all' && o.primary_technician_id !== selectedTechId) {
        return false;
      }
      if (selectedStatus !== 'all' && o.status !== selectedStatus) {
        return false;
      }
      return true;
    });
  }, [orders, selectedTechId, selectedStatus]);

  // Agrupamento por chave local YYYY-MM-DD para preenchimento rápido da grade
  const ordersByDateKey = useMemo(() => {
    const map: Record<string, ServiceOrder[]> = {};
    for (const o of filteredOrders) {
      if (!o.scheduled_start) continue;
      const key = toLocalDateKey(o.scheduled_start);
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(o);
    }
    return map;
  }, [filteredOrders]);

  // Lista corrida agrupada (usada no modo Lista)
  const groupedListEntries = useMemo(() => {
    const groups: Record<string, ServiceOrder[]> = {};
    for (const o of filteredOrders) {
      if (!o.scheduled_start) continue;
      const dayLabel = new Date(o.scheduled_start).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      if (!groups[dayLabel]) groups[dayLabel] = [];
      groups[dayLabel].push(o);
    }
    return Object.entries(groups);
  }, [filteredOrders]);

  const calendarCells = useMemo(
    () =>
      getMonthGridDays(
        currentMonthDate.getFullYear(),
        currentMonthDate.getMonth(),
        today
      ),
    [currentMonthDate, today]
  );

  const monthTitle = useMemo(() => {
    const label = currentMonthDate.toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [currentMonthDate]);

  const selectedDayOrders = ordersByDateKey[selectedDateKey] ?? [];

  const selectedDayFormatted = useMemo(() => {
    const [y, m, d] = selectedDateKey.split('-').map(Number);
    if (!y || !m || !d) return selectedDateKey;
    const dt = new Date(y, m - 1, d);
    const label = dt.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [selectedDateKey]);

  const goToPrevMonth = () => {
    setCurrentMonthDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  };

  const goToNextMonth = () => {
    setCurrentMonthDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDateKey(formatDateKeyLocal(now));
  };

  const openNewOrderForDate = (dateKey: string) => {
    if (!permissions.canCreateServiceOrder) return;
    setNewOSDefaultDate(dateKey);
    setNewOSOpen(true);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || e.changedTouches.length !== 1) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;

    const dir = detectHorizontalMonthSwipe(
      start.x,
      start.y,
      e.changedTouches[0].clientX,
      e.changedTouches[0].clientY
    );
    if (dir === 'next') goToNextMonth();
    if (dir === 'prev') goToPrevMonth();
  };

  // Drag & Drop handlers (Gestor)
  const handleDragStart = (e: React.DragEvent, order: ServiceOrder) => {
    if (!isDraggableServiceOrder(order, permissions.canAssignTechnicians)) {
      e.preventDefault();
      return;
    }
    setDraggedOrderId(order.id);
    e.dataTransfer.setData('text/plain', order.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedOrderId(null);
    setDragOverDateKey(null);
  };

  const handleDropOnDay = (e: React.DragEvent, targetDateKey: string) => {
    e.preventDefault();
    setDragOverDateKey(null);
    if (!permissions.canAssignTechnicians) return;

    const osId = e.dataTransfer.getData('text/plain') || draggedOrderId;
    setDraggedOrderId(null);
    if (!osId) return;

    const targetOrder = orders.find((o) => o.id === osId);
    if (!targetOrder || !targetOrder.scheduled_start) return;
    if (!isDraggableServiceOrder(targetOrder, permissions.canAssignTechnicians)) {
      setToastMsg('OS concluídas, faturadas ou canceladas não podem ser reagendadas.');
      return;
    }

    const currentKey = toLocalDateKey(targetOrder.scheduled_start);
    if (currentKey === targetDateKey) return;

    setPendingMove({ order: targetOrder, targetDateKey });
  };

  const handleConfirmReschedule = async () => {
    if (!activeCompany || !pendingMove || !pendingMove.order.scheduled_start) return;
    setSavingMove(true);
    setError(null);

    try {
      const shifted = shiftScheduledRangeToDate(
        pendingMove.order.scheduled_start,
        pendingMove.order.scheduled_end,
        pendingMove.targetDateKey
      );

      const { error: updErr } = await supabase
        .from('service_orders')
        .update({
          scheduled_start: shifted.scheduled_start,
          scheduled_end: shifted.scheduled_end,
        })
        .eq('id', pendingMove.order.id)
        .eq('company_id', activeCompany.id);

      if (updErr) {
        setError(translateSupabaseError(updErr));
      } else {
        setSelectedDateKey(pendingMove.targetDateKey);
        const [y, m, d] = pendingMove.targetDateKey.split('-');
        setToastMsg(
          `OS ${pendingMove.order.order_number} reagendada para ${d}/${m}/${y}.`
        );
        await loadSchedule();
      }
      setPendingMove(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao reagendar OS.');
    } finally {
      setSavingMove(false);
    }
  };

  const formatTimeShort = (iso?: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatKeyPtBr = (key: string) => {
    const [y, m, d] = key.split('-');
    return y && m && d ? `${d}/${m}/${y}` : key;
  };

  return (
    <div className="space-y-5">
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border border-slate-700 animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-slate-400 hover:text-white ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Cabeçalho Principal */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Agenda Técnica
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {permissions.canAssignTechnicians
              ? 'Calendário mensal estilo Google Agenda. Clique no dia para consultar ou criar OS, ou arraste um agendamento para alterar a data.'
              : 'Visualize suas visitas e manutenções agendadas por dia.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Alternador Mês / Lista */}
          <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-semibold transition-all ${
                viewMode === 'month'
                  ? 'bg-white text-teal-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Mês</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-semibold transition-all ${
                viewMode === 'list'
                  ? 'bg-white text-teal-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Lista</span>
            </button>
          </div>

          {permissions.canCreateServiceOrder && (
            <Button
              onClick={() => openNewOrderForDate(selectedDateKey)}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Agendar Atendimento
            </Button>
          )}
        </div>
      </div>

      {/* Barra de Navegação do Mês + Filtros por Técnico e Status */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center justify-between md:justify-start gap-2">
          <Button variant="outline" size="sm" onClick={goToToday}>
            Hoje
          </Button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToPrevMonth}
              aria-label="Mês anterior"
              className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              aria-label="Próximo mês"
              className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 ml-1">
            {monthTitle}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {permissions.canAssignTechnicians && technicians.length > 0 && (
            <select
              value={selectedTechId}
              onChange={(e) => setSelectedTechId(e.target.value)}
              aria-label="Filtrar agenda por técnico"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm text-slate-700"
            >
              <option value="all">Todos os técnicos</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          )}

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as 'all' | OSStatus)}
            aria-label="Filtrar agenda por status"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm text-slate-700"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {loading ? (
        <Card>
          <div className="py-12 text-center text-xs text-slate-400">
            Consultando agenda no banco de dados...
          </div>
        </Card>
      ) : viewMode === 'month' ? (
        <div className="space-y-5">
          {/* Grade Mensal Estilo Google Agenda */}
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden select-none sm:select-auto"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="sm:hidden px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 text-center">
              Deslize para o lado para trocar de mês • Toque no dia para ver detalhes
            </div>

            {/* Cabeçalho Dias da Semana */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80">
              {WEEKDAY_LABELS.map((day) => (
                <div
                  key={day}
                  className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-r last:border-r-0 border-slate-200/70"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Células do Mês */}
            <div className="grid grid-cols-7">
              {calendarCells.map((cell) => {
                const dayOrders = ordersByDateKey[cell.dateKey] ?? [];
                const isSelected = selectedDateKey === cell.dateKey;
                const isDropTarget = dragOverDateKey === cell.dateKey;

                return (
                  <div
                    key={cell.dateKey}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDateKey(cell.dateKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDateKey(cell.dateKey);
                      }
                    }}
                    onDragOver={(e) => {
                      if (!permissions.canAssignTechnicians || !draggedOrderId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverDateKey !== cell.dateKey) {
                        setDragOverDateKey(cell.dateKey);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverDateKey === cell.dateKey) {
                        setDragOverDateKey(null);
                      }
                    }}
                    onDrop={(e) => handleDropOnDay(e, cell.dateKey)}
                    className={`group min-h-[64px] sm:min-h-[116px] p-1.5 sm:p-2 border-b border-r border-slate-200/80 transition-colors cursor-pointer flex flex-col justify-between ${
                      isDropTarget
                        ? 'bg-teal-50 ring-2 ring-inset ring-teal-500'
                        : isSelected
                        ? 'bg-teal-50/40 ring-1 ring-inset ring-teal-500/60'
                        : !cell.inCurrentMonth
                        ? 'bg-slate-50/70 text-slate-400 hover:bg-slate-100/70'
                        : 'bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Número do dia + botão + desktop */}
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full text-xs font-bold transition-colors ${
                          cell.isToday
                            ? 'bg-teal-600 text-white shadow-xs'
                            : isSelected
                            ? 'bg-[#0B2545] text-white'
                            : cell.inCurrentMonth
                            ? 'text-slate-800'
                            : 'text-slate-400'
                        }`}
                      >
                        {cell.dayNumber}
                      </span>

                      {permissions.canCreateServiceOrder && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDateKey(cell.dateKey);
                            openNewOrderForDate(cell.dateKey);
                          }}
                          title={`Agendar OS em ${formatKeyPtBr(cell.dateKey)}`}
                          className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 w-5 h-5 rounded hover:bg-teal-100 text-teal-700 items-center justify-center transition-opacity"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Desktop: chips das OS do dia (arrastáveis para gestores) */}
                    <div className="hidden sm:flex flex-col gap-1 flex-1">
                      {dayOrders.slice(0, 3).map((os) => {
                        const color = os.primary_technician?.calendar_color || '#0D9488';
                        const canDrag = isDraggableServiceOrder(
                          os,
                          permissions.canAssignTechnicians
                        );

                        return (
                          <div
                            key={os.id}
                            draggable={canDrag}
                            onDragStart={(e) => handleDragStart(e, os)}
                            onDragEnd={handleDragEnd}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDateKey(cell.dateKey);
                              setSelectedOSId(os.id);
                            }}
                            title={`${formatTimeShort(os.scheduled_start)} • ${os.order_number} — ${os.title}`}
                            className={`px-1.5 py-1 rounded text-[10px] leading-tight font-medium text-white truncate flex items-center gap-1 shadow-2xs transition-opacity ${
                              canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                            } ${draggedOrderId === os.id ? 'opacity-40' : 'hover:opacity-95'}`}
                            style={{ backgroundColor: color }}
                          >
                            {canDrag && (
                              <GripVertical className="w-2.5 h-2.5 shrink-0 opacity-75" />
                            )}
                            <span className="font-bold shrink-0 tabular-nums">
                              {formatTimeShort(os.scheduled_start)}
                            </span>
                            <span className="truncate">
                              {os.client?.trade_name || os.client?.name || os.order_number}
                            </span>
                          </div>
                        );
                      })}
                      {dayOrders.length > 3 && (
                        <div className="text-[10px] font-semibold text-teal-700 px-1">
                          +{dayOrders.length - 3} mais
                        </div>
                      )}
                    </div>

                    {/* Celular: bolinhas coloridas + contagem */}
                    {dayOrders.length > 0 && (
                      <div className="sm:hidden flex items-center justify-center gap-1 pt-0.5 flex-wrap">
                        {dayOrders.slice(0, 3).map((os) => (
                          <span
                            key={os.id}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                os.primary_technician?.calendar_color || '#0D9488',
                            }}
                          />
                        ))}
                        {dayOrders.length > 3 && (
                          <span className="text-[9px] font-bold text-teal-700">
                            +{dayOrders.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Painel do Dia Selecionado (Detalhes + Ações rápidas para celular e desktop) */}
          <Card
            title={selectedDayFormatted}
            subtitle={`${selectedDayOrders.length} ${
              selectedDayOrders.length === 1
                ? 'agendamento neste dia'
                : 'agendamentos neste dia'
            }`}
            actions={
              permissions.canCreateServiceOrder ? (
                <Button
                  size="sm"
                  onClick={() => openNewOrderForDate(selectedDateKey)}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Agendar neste dia
                </Button>
              ) : undefined
            }
          >
            {selectedDayOrders.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 space-y-2">
                <p>Nenhum atendimento agendado para esta data com os filtros atuais.</p>
                {permissions.canCreateServiceOrder && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openNewOrderForDate(selectedDateKey)}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Criar OS para {formatKeyPtBr(selectedDateKey)}
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {selectedDayOrders.map((os) => {
                  const canMove = isDraggableServiceOrder(
                    os,
                    permissions.canAssignTechnicians
                  );
                  return (
                    <div
                      key={os.id}
                      className="p-4 rounded-xl border border-slate-200 hover:border-teal-500/60 hover:shadow-xs transition-all flex flex-col justify-between gap-3 bg-white"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedOSId(os.id)}
                        className="text-left space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    os.primary_technician?.calendar_color || '#0D9488',
                                }}
                              />
                              <span className="font-mono text-xs font-bold text-teal-700">
                                {os.order_number}
                              </span>
                            </div>
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
                      </button>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 truncate">
                          <Wrench className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                          <span className="truncate">
                            {os.primary_technician?.full_name || 'Técnico a definir'}
                          </span>
                        </span>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-semibold text-slate-900 tabular-nums">
                            {formatTimeShort(os.scheduled_start)}
                            {os.scheduled_end && ` – ${formatTimeShort(os.scheduled_end)}`}
                          </span>

                          {canMove && (
                            <button
                              type="button"
                              onClick={() => {
                                setMobileMoveOrder(os);
                                setMobileMoveDate(toLocalDateKey(os.scheduled_start!));
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-800 text-[11px] font-medium border border-slate-200 transition-colors"
                              title="Alterar data deste agendamento"
                            >
                              <CalendarClock className="w-3 h-3" />
                              <span>Mover</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ) : groupedListEntries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Calendar className="w-5 h-5" />}
            title="Nenhum compromisso agendado"
            description="Defina a data e horário de início em uma Ordem de Serviço para que ela seja organizada nesta agenda."
            action={
              permissions.canCreateServiceOrder ? (
                <Button
                  size="sm"
                  onClick={() => openNewOrderForDate(selectedDateKey)}
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
          {groupedListEntries.map(([dateLabel, dayOrders]) => (
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
                        {formatTimeShort(os.scheduled_start)}
                        {os.scheduled_end && ` – ${formatTimeShort(os.scheduled_end)}`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal de Alteração Rápida de Data no Celular / Botão Mover */}
      <Modal
        isOpen={Boolean(mobileMoveOrder)}
        onClose={() => setMobileMoveOrder(null)}
        title={
          mobileMoveOrder
            ? `Alterar Data — ${mobileMoveOrder.order_number}`
            : 'Alterar Data'
        }
        subtitle="O horário original do atendimento será mantido."
        footer={
          <>
            <Button variant="outline" onClick={() => setMobileMoveOrder(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                !mobileMoveOrder ||
                !mobileMoveDate ||
                mobileMoveDate ===
                  (mobileMoveOrder.scheduled_start
                    ? toLocalDateKey(mobileMoveOrder.scheduled_start)
                    : '')
              }
              onClick={() => {
                if (!mobileMoveOrder || !mobileMoveDate) return;
                const ord = mobileMoveOrder;
                const dt = mobileMoveDate;
                setMobileMoveOrder(null);
                setPendingMove({ order: ord, targetDateKey: dt });
              }}
            >
              Continuar
            </Button>
          </>
        }
      >
        {mobileMoveOrder && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">
              OS: <strong className="text-slate-900">{mobileMoveOrder.title}</strong>
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nova data do agendamento
              </label>
              <input
                type="date"
                value={mobileMoveDate}
                onChange={(e) => setMobileMoveDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de Confirmação de Reagendamento (Drag & Drop ou Mover) */}
      <Modal
        isOpen={Boolean(pendingMove)}
        onClose={() => !savingMove && setPendingMove(null)}
        title="Confirmar Reagendamento da OS"
        subtitle="O histórico e os horários originais do atendimento serão preservados."
        footer={
          <>
            <Button
              variant="outline"
              disabled={savingMove}
              onClick={() => setPendingMove(null)}
            >
              Cancelar
            </Button>
            <Button
              isLoading={savingMove}
              onClick={() => void handleConfirmReschedule()}
            >
              Confirmar Nova Data
            </Button>
          </>
        }
      >
        {pendingMove && (
          <div className="space-y-3 text-xs text-slate-700">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-mono font-bold text-teal-700">
                {pendingMove.order.order_number}
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {pendingMove.order.title}
              </div>
              <div className="text-slate-600">
                Cliente: {pendingMove.order.client?.trade_name || pendingMove.order.client?.name}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 rounded-lg border border-slate-200">
                <div className="text-[10px] uppercase text-slate-400 font-semibold">
                  Data Atual
                </div>
                <div className="font-bold text-slate-800 mt-0.5">
                  {pendingMove.order.scheduled_start
                    ? formatKeyPtBr(toLocalDateKey(pendingMove.order.scheduled_start))
                    : '—'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {formatTimeShort(pendingMove.order.scheduled_start)}
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-teal-300 bg-teal-50/50">
                <div className="text-[10px] uppercase text-teal-700 font-semibold">
                  Nova Data
                </div>
                <div className="font-bold text-teal-900 mt-0.5">
                  {formatKeyPtBr(pendingMove.targetDateKey)}
                </div>
                <div className="text-[11px] text-teal-700">
                  {formatTimeShort(pendingMove.order.scheduled_start)}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <NewServiceOrderModal
        isOpen={newOSOpen}
        onClose={() => setNewOSOpen(false)}
        onCreated={() => {
          setSelectedDateKey(newOSDefaultDate);
          void loadSchedule();
        }}
        defaultScheduledDate={newOSDefaultDate}
      />

      <ServiceOrderDetailModal
        osId={selectedOSId}
        onClose={() => setSelectedOSId(null)}
        onUpdated={() => void loadSchedule()}
      />
    </div>
  );
};
