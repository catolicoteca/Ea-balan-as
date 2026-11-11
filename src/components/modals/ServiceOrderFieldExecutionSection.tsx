import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Navigation,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Cloud,
  CloudOff,
  Loader2,
  ExternalLink,
  ClipboardCheck,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import { translateSupabaseError } from '../../lib/errors';
import {
  captureCurrentCoordinates,
  CHECKLIST_STATUS_LABELS,
  getChecklistProgress,
  getGoogleMapsLink,
  parseExecutionMetadata,
  SCALE_CHECKLIST_ITEMS,
  serializeExecutionMetadata,
  type ParsedScaleExecutionMetadata,
} from '../../lib/fieldExecution';
import type {
  ChecklistItemStatus,
  ScaleChecklistKey,
  ServiceOrder,
  ServiceOrderExecution,
} from '../../types/database';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/EmptyState';

interface ServiceOrderFieldExecutionSectionProps {
  order: ServiceOrder;
  companyId: string;
  onOrderUpdated: () => void;
  onExecutionChanged?: (execution: ServiceOrderExecution | null) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const ServiceOrderFieldExecutionSection: React.FC<
  ServiceOrderFieldExecutionSectionProps
> = ({ order, companyId, onOrderUpdated, onExecutionChanged }) => {
  const { user, myTechnician, effectiveRole } = useAuthTenant();

  const onExecChangedRef = useRef(onExecutionChanged);
  onExecChangedRef.current = onExecutionChanged;

  const [execution, setExecution] = useState<ServiceOrderExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<'travel' | 'checkin' | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estados editáveis do atendimento em campo
  const [metadata, setMetadata] = useState<ParsedScaleExecutionMetadata>(() =>
    parseExecutionMetadata(null)
  );
  const [diagnosis, setDiagnosis] = useState('');
  const [performedServices, setPerformedServices] = useState('');
  const [removedSeal, setRemovedSeal] = useState('');
  const [appliedSeal, setAppliedSeal] = useState('');
  const [equipmentApproved, setEquipmentApproved] = useState<boolean | null>(null);

  // Controle para evitar auto-save no carregamento inicial
  const isHydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executionIdRef = useRef<string | null>(null);

  const resolvedTechnicianId =
    myTechnician?.id || order.primary_technician_id || null;

  const isClosed = order.status === 'completed' || order.status === 'cancelled';
  const canEdit =
    !isClosed &&
    (effectiveRole === 'technician' ||
      effectiveRole === 'manager' ||
      effectiveRole === 'platform_admin') &&
    Boolean(resolvedTechnicianId);

  // 1. Carrega registro existente de service_order_executions
  const loadExecution = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    isHydratedRef.current = false;

    const { data, error } = await supabase
      .from('service_order_executions')
      .select('*')
      .eq('company_id', companyId)
      .eq('service_order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setErrorMsg(translateSupabaseError(error));
      setLoading(false);
      return;
    }

    if (data) {
      const exec = data as ServiceOrderExecution;
      setExecution(exec);
      onExecChangedRef.current?.(exec);
      executionIdRef.current = exec.id;
      setMetadata(parseExecutionMetadata(exec.calibration_measurements));
      setDiagnosis(exec.diagnosis ?? '');
      setPerformedServices(exec.performed_services ?? '');
      setRemovedSeal(exec.removed_seal_number ?? '');
      setAppliedSeal(exec.applied_seal_number ?? '');
      setEquipmentApproved(exec.equipment_approved ?? null);
    } else {
      setExecution(null);
      onExecChangedRef.current?.(null);
      executionIdRef.current = null;
      setMetadata(parseExecutionMetadata(null));
      setDiagnosis('');
      setPerformedServices('');
      setRemovedSeal('');
      setAppliedSeal('');
      setEquipmentApproved(null);
    }

    setLoading(false);
    // Marca como hidratado após o próximo tick para não disparar auto-save inicial
    setTimeout(() => {
      isHydratedRef.current = true;
    }, 50);
  }, [companyId, order.id]);

  useEffect(() => {
    void loadExecution();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [loadExecution]);

  // 2. Persistência segura no Supabase (INSERT se não existir, UPDATE se existir)
  const persistExecutionToDatabase = useCallback(
    async (overrides?: {
      meta?: ParsedScaleExecutionMetadata;
      lat?: number | null;
      lng?: number | null;
      startedAt?: string;
    }) => {
      if (!resolvedTechnicianId) {
        setErrorMsg(
          'Nenhum técnico vinculado a esta Ordem de Serviço para registrar a execução.'
        );
        return null;
      }

      const activeMeta = overrides?.meta ?? metadata;
      const serializedMeta = serializeExecutionMetadata(activeMeta);

      setSaveState('saving');
      setErrorMsg(null);

      try {
        const currentId = executionIdRef.current;

        if (currentId) {
          const updatePayload: Record<string, unknown> = {
            diagnosis: diagnosis.trim() || null,
            performed_services: performedServices.trim() || null,
            removed_seal_number: removedSeal.trim() || null,
            applied_seal_number: appliedSeal.trim() || null,
            equipment_approved: equipmentApproved,
            calibration_measurements: serializedMeta,
          };

          if (overrides?.lat !== undefined) {
            updatePayload.checkin_latitude = overrides.lat;
          }
          if (overrides?.lng !== undefined) {
            updatePayload.checkin_longitude = overrides.lng;
          }

          const { data, error } = await supabase
            .from('service_order_executions')
            .update(updatePayload)
            .eq('id', currentId)
            .eq('company_id', companyId)
            .select('*')
            .single();

          if (error) throw error;
          const updated = data as ServiceOrderExecution;
          setExecution(updated);
          onExecChangedRef.current?.(updated);
          executionIdRef.current = updated.id;
          setSaveState('saved');
          setLastSavedAt(
            new Date().toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          );
          return updated;
        } else {
          const insertPayload = {
            company_id: companyId,
            service_order_id: order.id,
            technician_id: resolvedTechnicianId,
            started_at: overrides?.startedAt ?? new Date().toISOString(),
            checkin_latitude: overrides?.lat ?? null,
            checkin_longitude: overrides?.lng ?? null,
            diagnosis: diagnosis.trim() || null,
            performed_services: performedServices.trim() || null,
            removed_seal_number: removedSeal.trim() || null,
            applied_seal_number: appliedSeal.trim() || null,
            equipment_approved: equipmentApproved,
            calibration_measurements: serializedMeta,
          };

          const { data, error } = await supabase
            .from('service_order_executions')
            .insert(insertPayload)
            .select('*')
            .single();

          if (error) throw error;
          const inserted = data as ServiceOrderExecution;
          setExecution(inserted);
          onExecChangedRef.current?.(inserted);
          executionIdRef.current = inserted.id;
          setSaveState('saved');
          setLastSavedAt(
            new Date().toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          );
          return inserted;
        }
      } catch (err: unknown) {
        setSaveState('error');
        setErrorMsg(translateSupabaseError(err));
        return null;
      }
    },
    [
      appliedSeal,
      companyId,
      diagnosis,
      equipmentApproved,
      metadata,
      order.id,
      performedServices,
      removedSeal,
      resolvedTechnicianId,
    ]
  );

  // 3. Auto-save com debounce quando campos de diagnóstico/checklist mudam
  useEffect(() => {
    if (!isHydratedRef.current || !canEdit) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState('saving');

    saveTimerRef.current = setTimeout(() => {
      void persistExecutionToDatabase();
    }, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    diagnosis,
    performedServices,
    removedSeal,
    appliedSeal,
    equipmentApproved,
    metadata,
    canEdit,
    persistExecutionToDatabase,
  ]);

  // Helper para atualizar status da OS para 'in_progress' se ainda aberta/agendada
  const promoteOrderToInProgressIfNeeded = async () => {
    if (order.status === 'open' || order.status === 'scheduled') {
      const nowIso = new Date().toISOString();
      await supabase
        .from('service_orders')
        .update({
          status: 'in_progress',
          started_at: order.started_at ?? nowIso,
        })
        .eq('id', order.id)
        .eq('company_id', companyId);
    }
  };

  // Helper para registrar evento auditável em service_order_history
  const recordFieldHistoryEvent = async (
    eventType: string,
    description: string,
    payload: Record<string, unknown> = {}
  ) => {
    await supabase.from('service_order_history').insert({
      company_id: companyId,
      service_order_id: order.id,
      actor_user_id: user?.id ?? null,
      event_type: eventType,
      old_status: order.status,
      new_status:
        order.status === 'open' || order.status === 'scheduled'
          ? 'in_progress'
          : order.status,
      description,
      payload,
    });
  };

  // 4. Ação: Iniciar Deslocamento
  const handleStartTravel = async () => {
    if (!canEdit) return;
    setActionBusy('travel');
    setErrorMsg(null);

    try {
      const nowIso = new Date().toISOString();
      const gps = await captureCurrentCoordinates();

      const nextMeta: ParsedScaleExecutionMetadata = {
        ...metadata,
        travel_started_at: nowIso,
        travel_latitude: gps.ok ? (gps.latitude ?? null) : null,
        travel_longitude: gps.ok ? (gps.longitude ?? null) : null,
      };
      setMetadata(nextMeta);

      await persistExecutionToDatabase({
        meta: nextMeta,
        startedAt: nowIso,
      });

      await promoteOrderToInProgressIfNeeded();

      const timeFmt = new Date(nowIso).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      await recordFieldHistoryEvent(
        'travel_started',
        `Técnico iniciou deslocamento para atendimento às ${timeFmt}.`,
        {
          travel_started_at: nowIso,
          latitude: gps.ok ? gps.latitude : null,
          longitude: gps.ok ? gps.longitude : null,
        }
      );

      onOrderUpdated();
    } catch (err: unknown) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setActionBusy(null);
    }
  };

  // 5. Ação: Registrar Chegada (Check-in com GPS + Horário)
  const handleRegisterArrival = async () => {
    if (!canEdit) return;
    setActionBusy('checkin');
    setErrorMsg(null);

    try {
      const nowIso = new Date().toISOString();
      const gps = await captureCurrentCoordinates();

      const nextMeta: ParsedScaleExecutionMetadata = {
        ...metadata,
        travel_started_at: metadata.travel_started_at ?? nowIso,
        arrived_at: nowIso,
        checkin_accuracy_meters: gps.ok ? (gps.accuracy ?? null) : null,
        gps_fallback_reason: gps.ok ? null : (gps.errorReason ?? 'GPS indisponível'),
      };
      setMetadata(nextMeta);

      await persistExecutionToDatabase({
        meta: nextMeta,
        lat: gps.ok ? (gps.latitude ?? null) : null,
        lng: gps.ok ? (gps.longitude ?? null) : null,
        startedAt: metadata.travel_started_at ?? nowIso,
      });

      await promoteOrderToInProgressIfNeeded();

      const timeFmt = new Date(nowIso).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const gpsDesc = gps.ok
        ? `Check-in registrado no cliente às ${timeFmt} (GPS: ${gps.latitude}, ${gps.longitude}).`
        : `Chegada registrada às ${timeFmt} (GPS indisponível: ${gps.errorReason}).`;

      await recordFieldHistoryEvent('arrived_checkin', gpsDesc, {
        arrived_at: nowIso,
        latitude: gps.ok ? gps.latitude : null,
        longitude: gps.ok ? gps.longitude : null,
        accuracy: gps.ok ? gps.accuracy : null,
      });

      onOrderUpdated();
    } catch (err: unknown) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setActionBusy(null);
    }
  };

  // 6. Atualização de item do checklist com toque único
  const handleChecklistToggle = (
    key: ScaleChecklistKey,
    status: ChecklistItemStatus
  ) => {
    if (!canEdit) return;
    setMetadata((prev) => ({
      ...prev,
      checklist: {
        ...prev.checklist,
        [key]: status,
      },
    }));
  };

  const progress = getChecklistProgress(metadata.checklist);
  const checkinLat = execution?.checkin_latitude ?? null;
  const checkinLng = execution?.checkin_longitude ?? null;

  if (loading) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
        Carregando dados de deslocamento, check-in e checklist técnico...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

      {/* ==================================================================== */}
      {/* BLOCO 1: DESLOCAMENTO & REGISTRO DE CHEGADA (GPS + HORÁRIO)          */}
      {/* ==================================================================== */}
      <div className="p-4 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/60 to-white space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Navigation className="w-4 h-4 text-teal-700" />
            Deslocamento &amp; Check-in em Campo
          </div>

          {/* Indicador de auto-save */}
          <div className="flex items-center gap-1.5 text-[11px]">
            {saveState === 'saving' && (
              <span className="inline-flex items-center gap-1 text-sky-700 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                Salvando na nuvem...
              </span>
            )}
            {saveState === 'saved' && (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <Cloud className="w-3.5 h-3.5" />
                Salvo automaticamente {lastSavedAt ? `às ${lastSavedAt}` : ''}
              </span>
            )}
            {saveState === 'error' && (
              <button
                type="button"
                onClick={() => void persistExecutionToDatabase()}
                className="inline-flex items-center gap-1 text-red-700 font-semibold underline"
              >
                <CloudOff className="w-3.5 h-3.5" />
                Falha ao salvar — tocar para tentar
              </button>
            )}
          </div>
        </div>

        {/* Botões Touch-Friendly Principais */}
        {canEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {!metadata.travel_started_at && !metadata.arrived_at && (
              <Button
                type="button"
                variant="primary"
                className="w-full justify-center py-3 text-sm font-semibold shadow-sm bg-sky-600 hover:bg-sky-700"
                isLoading={actionBusy === 'travel'}
                onClick={handleStartTravel}
                leftIcon={<Navigation className="w-4 h-4" />}
              >
                Iniciar Deslocamento
              </Button>
            )}

            {!metadata.arrived_at && (
              <Button
                type="button"
                variant="primary"
                className={`w-full justify-center py-3 text-sm font-semibold shadow-sm bg-emerald-600 hover:bg-emerald-700 ${
                  metadata.travel_started_at ? 'sm:col-span-2' : ''
                }`}
                isLoading={actionBusy === 'checkin'}
                onClick={handleRegisterArrival}
                leftIcon={<MapPin className="w-4 h-4" />}
              >
                Registrar Chegada (GPS + Horário)
              </Button>
            )}
          </div>
        )}

        {/* Resumo Visual dos Registros de Horário e Localização */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div
            className={`p-3 rounded-lg border ${
              metadata.travel_started_at
                ? 'bg-sky-50/70 border-sky-200 text-sky-950'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Início do Deslocamento
            </div>
            <div className="font-semibold mt-0.5">
              {metadata.travel_started_at
                ? new Date(metadata.travel_started_at).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : 'Aguardando início do deslocamento'}
            </div>
          </div>

          <div
            className={`p-3 rounded-lg border ${
              metadata.arrived_at
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              Chegada no Cliente (Check-in)
            </div>
            <div className="font-semibold mt-0.5">
              {metadata.arrived_at
                ? new Date(metadata.arrived_at).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : 'Chegada ainda não registrada'}
            </div>

            {checkinLat !== null && checkinLng !== null ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-mono text-emerald-800 bg-white/80 px-1.5 py-0.5 rounded border border-emerald-200">
                  {checkinLat}, {checkinLng}
                </span>
                {metadata.checkin_accuracy_meters && (
                  <span className="text-emerald-700">
                    (±{metadata.checkin_accuracy_meters}m)
                  </span>
                )}
                <a
                  href={getGoogleMapsLink(checkinLat, checkinLng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-teal-700 font-semibold hover:underline"
                >
                  <span>Ver mapa</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : (
              metadata.arrived_at &&
              metadata.gps_fallback_reason && (
                <div className="mt-1 text-[11px] text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>{metadata.gps_fallback_reason}</span>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* BLOCO 2: CHECKLIST TÉCNICO DE BALANÇAS                               */}
      {/* ==================================================================== */}
      <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <ClipboardCheck className="w-4 h-4 text-teal-700" />
              Checklist Metrológico de Balanças
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Toque no estado encontrado em cada ponto de inspeção. O progresso é salvo automaticamente.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                progress.isComplete
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {progress.answered}/{progress.total} itens ({progress.percentage}%)
            </span>
          </div>
        </div>

        {/* Barra de Progresso */}
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              progress.issuesCount > 0 ? 'bg-amber-500' : 'bg-teal-600'
            }`}
            style={{ width: `${progress.percentage}%` }}
          />
        </div>

        {/* Lista de Itens do Checklist */}
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {SCALE_CHECKLIST_ITEMS.map((item) => {
            const currentVal = metadata.checklist[item.key];
            return (
              <div
                key={item.key}
                className="p-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-semibold text-slate-800">
                    {item.label}
                  </div>
                  <div className="text-[11px] text-slate-500 leading-snug">
                    {item.description}
                  </div>
                </div>

                {/* Botões Touch-Friendly */}
                <div className="grid grid-cols-4 gap-1.5 shrink-0">
                  {(['ok', 'attention', 'fail', 'na'] as ChecklistItemStatus[]).map(
                    (st) => {
                      const isSelected = currentVal === st;
                      let activeClass = 'bg-slate-900 text-white border-slate-900';
                      if (isSelected && st === 'ok') {
                        activeClass =
                          'bg-emerald-600 text-white border-emerald-600 shadow-xs';
                      } else if (isSelected && st === 'attention') {
                        activeClass =
                          'bg-amber-500 text-white border-amber-500 shadow-xs';
                      } else if (isSelected && st === 'fail') {
                        activeClass =
                          'bg-red-600 text-white border-red-600 shadow-xs';
                      } else if (isSelected && st === 'na') {
                        activeClass =
                          'bg-slate-600 text-white border-slate-600 shadow-xs';
                      }

                      return (
                        <button
                          key={st}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleChecklistToggle(item.key, st)}
                          className={`px-2.5 py-2 sm:py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                            isSelected
                              ? activeClass
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          } ${!canEdit ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                          {CHECKLIST_STATUS_LABELS[st]}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* BLOCO 3: DIAGNÓSTICO TÉCNICO, SERVIÇOS E CONTROLE DE LACRES          */}
      {/* ==================================================================== */}
      <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3.5">
        <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
          <Wrench className="w-4 h-4 text-teal-700" />
          Diagnóstico Técnico &amp; Lacres INMETRO
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Diagnóstico Técnico Encontrado em Campo
            </label>
            <textarea
              rows={3}
              disabled={!canEdit}
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="Descreva a causa raiz do defeito, leitura de célula, desvio de calibração ou avaria identificada..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Serviços Executados e Ajustes Realizados
            </label>
            <textarea
              rows={2}
              disabled={!canEdit}
              value={performedServices}
              onChange={(e) => setPerformedServices(e.target.value)}
              placeholder="Descreva limpeza, calibração com pesos padrão, soldagem, troca de componente..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nº Lacre Retirado (Anterior)
              </label>
              <input
                type="text"
                disabled={!canEdit}
                value={removedSeal}
                onChange={(e) => setRemovedSeal(e.target.value)}
                placeholder="Ex.: SP-884120"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nº Novo Lacre Aplicado
              </label>
              <input
                type="text"
                disabled={!canEdit}
                value={appliedSeal}
                onChange={(e) => setAppliedSeal(e.target.value)}
                placeholder="Ex.: SP-992341"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50"
              />
            </div>
          </div>

          {/* Parecer Final de Aprovação Metrológica */}
          <div className="pt-1">
            <label className="block text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
              Parecer Técnico da Balança
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEquipmentApproved(true)}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 ${
                  equipmentApproved === true
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Aprovada
              </button>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEquipmentApproved(false)}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 ${
                  equipmentApproved === false
                    ? 'bg-red-600 text-white border-red-600 shadow-xs'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Reprovada
              </button>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEquipmentApproved(null)}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                  equipmentApproved === null
                    ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Em Análise
              </button>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                isLoading={saveState === 'saving'}
                onClick={() => void persistExecutionToDatabase()}
                leftIcon={<Cloud className="w-3.5 h-3.5 text-teal-600" />}
              >
                Salvar Progresso Agora
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
