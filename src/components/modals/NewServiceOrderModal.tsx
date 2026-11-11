import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import { translateSupabaseError } from '../../lib/errors';
import { serviceOrderSchema, zodErrorsToMap } from '../../lib/validation';
import type {
  Client,
  ClientUnit,
  Equipment,
  OSPriority,
  OSType,
  Technician,
} from '../../types/database';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  CheckboxField,
  InputField,
  SelectField,
  TextareaField,
} from '../ui/FormField';
import { AlertBanner } from '../ui/EmptyState';

interface NewServiceOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultScheduledDate?: string;
}

export const NewServiceOrderModal: React.FC<NewServiceOrderModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  defaultScheduledDate = '',
}) => {
  const { activeCompany, user } = useAuthTenant();

  const [clients, setClients] = useState<Client[]>([]);
  const [units, setUnits] = useState<ClientUnit[]>([]);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);

  const [clientId, setClientId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [primaryTechId, setPrimaryTechId] = useState('');
  const [assistantTechIds, setAssistantTechIds] = useState<string[]>([]);
  const [orderType, setOrderType] = useState<OSType>('corrective');
  const [priority, setPriority] = useState<OSPriority>('medium');
  const [title, setTitle] = useState('');
  const [reportedIssue, setReportedIssue] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [allowCompanyTechsView, setAllowCompanyTechsView] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !activeCompany) return;

    setFieldErrors({});
    setSubmitError(null);
    if (defaultScheduledDate) {
      setScheduledStart(`${defaultScheduledDate}T08:30`);
      setScheduledEnd(`${defaultScheduledDate}T10:30`);
    }

    let cancelled = false;
    setLoadingRefs(true);

    Promise.all([
      supabase
        .from('clients')
        .select('*')
        .eq('company_id', activeCompany.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('technicians')
        .select('*')
        .eq('company_id', activeCompany.id)
        .eq('is_active', true)
        .order('full_name', { ascending: true }),
    ]).then(([clientsRes, techsRes]) => {
      if (cancelled) return;
      setClients((clientsRes.data as Client[]) ?? []);
      setTechnicians((techsRes.data as Technician[]) ?? []);
      setLoadingRefs(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeCompany, defaultScheduledDate]);

  // Carrega unidades e balanças do cliente selecionado
  useEffect(() => {
    if (!activeCompany || !clientId) {
      setUnits([]);
      setEquipments([]);
      setUnitId('');
      setEquipmentId('');
      return;
    }

    let cancelled = false;
    Promise.all([
      supabase
        .from('client_units')
        .select('*')
        .eq('company_id', activeCompany.id)
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('is_primary', { ascending: false }),
      supabase
        .from('equipments')
        .select('*')
        .eq('company_id', activeCompany.id)
        .eq('client_id', clientId)
        .neq('status', 'condemned')
        .order('brand', { ascending: true }),
    ]).then(([unitsRes, equipsRes]) => {
      if (cancelled) return;
      const loadedUnits = (unitsRes.data as ClientUnit[]) ?? [];
      const loadedEquips = (equipsRes.data as Equipment[]) ?? [];
      setUnits(loadedUnits);
      setEquipments(loadedEquips);
      setUnitId(loadedUnits[0]?.id ?? '');
      setEquipmentId('');
    });

    return () => {
      cancelled = true;
    };
  }, [activeCompany, clientId]);

  const resetForm = () => {
    setClientId('');
    setUnitId('');
    setEquipmentId('');
    setPrimaryTechId('');
    setAssistantTechIds([]);
    setOrderType('corrective');
    setPriority('medium');
    setTitle('');
    setReportedIssue('');
    setInternalNotes('');
    setScheduledStart('');
    setScheduledEnd('');
    setAllowCompanyTechsView(false);
    setFieldErrors({});
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;

    setFieldErrors({});
    setSubmitError(null);

    const parsed = serviceOrderSchema.safeParse({
      client_id: clientId,
      unit_id: unitId || undefined,
      equipment_id: equipmentId || undefined,
      primary_technician_id: primaryTechId || undefined,
      order_type: orderType,
      priority,
      title,
      reported_issue: reportedIssue,
      internal_notes: internalNotes || undefined,
      scheduled_start: scheduledStart || undefined,
      scheduled_end: scheduledEnd || undefined,
      allow_company_technicians_view: allowCompanyTechsView,
    });

    if (!parsed.success) {
      setFieldErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        company_id: activeCompany.id,
        client_id: parsed.data.client_id,
        unit_id: parsed.data.unit_id || null,
        equipment_id: parsed.data.equipment_id || null,
        primary_technician_id: parsed.data.primary_technician_id || null,
        order_type: parsed.data.order_type,
        priority: parsed.data.priority,
        status: parsed.data.scheduled_start ? ('scheduled' as const) : ('open' as const),
        title: parsed.data.title,
        reported_issue: parsed.data.reported_issue,
        internal_notes: parsed.data.internal_notes || null,
        scheduled_start: parsed.data.scheduled_start
          ? new Date(parsed.data.scheduled_start).toISOString()
          : null,
        scheduled_end: parsed.data.scheduled_end
          ? new Date(parsed.data.scheduled_end).toISOString()
          : null,
        allow_company_technicians_view: parsed.data.allow_company_technicians_view,
        created_by: user?.id ?? null,
      };

      const { data: insertedOS, error } = await supabase
        .from('service_orders')
        .insert(payload)
        .select('id')
        .single();

      if (error) {
        setSubmitError(translateSupabaseError(error));
        return;
      }

      // Insere técnicos auxiliares adicionais caso selecionados
      const extraTechs = assistantTechIds.filter(
        (tid) => tid && tid !== primaryTechId
      );
      if (insertedOS?.id && extraTechs.length > 0) {
        const assignmentRows = extraTechs.map((tid) => ({
          company_id: activeCompany.id,
          service_order_id: insertedOS.id,
          technician_id: tid,
          assignment_role: 'assistant' as const,
          is_active: true,
          assigned_by: user?.id ?? null,
        }));
        await supabase.from('service_order_assignments').insert(assignmentRows);
      }

      resetForm();
      onCreated();
      onClose();
    } catch (err) {
      setSubmitError(translateSupabaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAssistantTech = (techId: string) => {
    setAssistantTechIds((prev) =>
      prev.includes(techId) ? prev.filter((id) => id !== techId) : [...prev, techId]
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nova Ordem de Serviço"
      subtitle={`Abertura e atribuição de atendimento técnico — ${activeCompany?.name ?? ''}`}
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="new-os-form"
            isLoading={submitting}
            disabled={clients.length === 0}
            leftIcon={<PlusCircle className="w-4 h-4" />}
          >
            Gerar Ordem de Serviço
          </Button>
        </>
      }
    >
      <form id="new-os-form" onSubmit={handleSubmit} className="space-y-4">
        {submitError && <AlertBanner variant="error" message={submitError} />}

        {!loadingRefs && clients.length === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex items-center justify-between gap-3">
            <div>
              <strong>Nenhum cliente cadastrado nesta empresa ainda.</strong>{' '}
              Cadastre ao menos um cliente para vincular a Ordem de Serviço.
            </div>
            <Link
              to="/app/clientes"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-amber-800 text-white font-medium shrink-0 hover:bg-amber-900"
            >
              Cadastrar Cliente
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Cliente"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            error={fieldErrors.client_id}
          >
            <option value="">Selecione o cliente...</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.trade_name ? `${c.trade_name} (${c.name})` : c.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Unidade / Endereço de Atendimento"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!clientId || units.length === 0}
            hint={
              clientId && units.length === 0
                ? 'Cliente sem unidade cadastrada (atendimento geral).'
                : undefined
            }
          >
            <option value="">Selecione a unidade (opcional)...</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unit_name} — {u.city}/{u.state}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <SelectField
              label="Balança / Equipamento"
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              disabled={!clientId || equipments.length === 0}
              hint={
                clientId && equipments.length === 0
                  ? 'Nenhuma balança cadastrada para este cliente.'
                  : undefined
              }
            >
              <option value="">Selecione o equipamento (opcional)...</option>
              {equipments.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.brand} {eq.model} • S/N {eq.serial_number}
                  {eq.capacity_label ? ` (${eq.capacity_label})` : ''}
                </option>
              ))}
            </SelectField>
          </div>

          <SelectField
            label="Tipo de Serviço"
            required
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as OSType)}
          >
            <option value="corrective">Manutenção Corretiva</option>
            <option value="preventive">Manutenção Preventiva</option>
            <option value="calibration">Calibração / Aferição</option>
            <option value="installation">Instalação</option>
            <option value="inspection">Vistoria Técnica</option>
          </SelectField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <InputField
              label="Título Resumido da OS"
              required
              placeholder="Ex.: Calibração semestral balança rodoviária 80t"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={fieldErrors.title}
            />
          </div>

          <SelectField
            label="Prioridade"
            required
            value={priority}
            onChange={(e) => setPriority(e.target.value as OSPriority)}
          >
            <option value="low">Baixa</option>
            <option value="medium">Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente (Parada de Linha)</option>
          </SelectField>
        </div>

        <TextareaField
          label="Defeito Relatado / Escopo Solicitado"
          required
          rows={3}
          placeholder="Descreva os sintomas informados pelo cliente, erro no indicador, variação de pesagem ou requisitos da calibração..."
          value={reportedIssue}
          onChange={(e) => setReportedIssue(e.target.value)}
          error={fieldErrors.reported_issue}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 border-t border-slate-100">
          <SelectField
            label="Técnico Responsável"
            value={primaryTechId}
            onChange={(e) => setPrimaryTechId(e.target.value)}
          >
            <option value="">Definir posteriormente</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </SelectField>

          <InputField
            label="Início Agendado"
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            error={fieldErrors.scheduled_start}
          />

          <InputField
            label="Término Previsto"
            type="datetime-local"
            value={scheduledEnd}
            onChange={(e) => setScheduledEnd(e.target.value)}
            error={fieldErrors.scheduled_end}
          />
        </div>

        {technicians.length > 1 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-700">
              Técnicos Auxiliares Co-atribuídos (opcional)
            </div>
            <div className="flex flex-wrap gap-2">
              {technicians
                .filter((t) => t.id !== primaryTechId)
                .map((t) => {
                  const selected = assistantTechIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleAssistantTech(t.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-teal-50 border-teal-500 text-teal-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {selected ? '✓ ' : '+ '}
                      {t.full_name}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        <TextareaField
          label="Observações Internas / Orientações de Acesso"
          rows={2}
          placeholder="Ex.: Levar pesos-padrão M1 de 20 kg; exigir integração de segurança EPI na portaria."
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
        />

        <CheckboxField
          label="Autorização explícita para visualização por outros técnicos desta empresa"
          description="Por padrão (RLS), apenas os técnicos atribuídos a esta OS podem visualizá-la. Marque somente se desejar permitir consulta compartilhada pela equipe técnica da empresa."
          checked={allowCompanyTechsView}
          onChange={(e) => setAllowCompanyTechsView(e.target.checked)}
        />
      </form>
    </Modal>
  );
};
