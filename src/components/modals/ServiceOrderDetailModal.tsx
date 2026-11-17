import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Scale,
  ShieldCheck,
  UserCheck,
  History,
  Share2,
  Plus,
  Trash2,
  Layers,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import { translateSupabaseError } from '../../lib/errors';
import { buildWhatsAppUrl } from '../../lib/validation';
import type {
  Equipment,
  OSStatus,
  ServiceOrder,
  ServiceOrderAttachment,
  ServiceOrderEquipment,
  ServiceOrderExecution,
  ServiceOrderHistoryItem,
  ServiceOrderItem,
  ServiceOrderSignature,
  Technician,
} from '../../types/database';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  OSPriorityBadge,
  OSStatusBadge,
  OS_TYPE_LABELS,
} from '../ui/Badge';
import { AlertBanner } from '../ui/EmptyState';
import { CheckboxField, InputField, SelectField } from '../ui/FormField';
import { ServiceOrderItemsSection } from './ServiceOrderItemsSection';
import { ServiceOrderFieldExecutionSection } from './ServiceOrderFieldExecutionSection';
import { ServiceOrderPhotosSection } from './ServiceOrderPhotosSection';
import { ServiceOrderSignatureSection } from './ServiceOrderSignatureSection';
import { ServiceOrderClosureAndPdfSection } from './ServiceOrderClosureAndPdfSection';

interface ServiceOrderDetailModalProps {
  osId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

export const ServiceOrderDetailModal: React.FC<ServiceOrderDetailModalProps> = ({
  osId,
  onClose,
  onUpdated,
}) => {
  const { activeCompany, permissions } = useAuthTenant();

  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [history, setHistory] = useState<ServiceOrderHistoryItem[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [nextStatus, setNextStatus] = useState<OSStatus>('open');
  const [nextPrimaryTechId, setNextPrimaryTechId] = useState<string>('');
  const [allowSharedTechView, setAllowSharedTechView] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Estados consolidados de execução em campo (Etapa 2 e Etapa 3)
  const [fieldExecution, setFieldExecution] =
    useState<ServiceOrderExecution | null>(null);
  const [fieldAttachments, setFieldAttachments] = useState<
    ServiceOrderAttachment[]
  >([]);
  const [fieldSignatures, setFieldSignatures] = useState<
    ServiceOrderSignature[]
  >([]);
  const [fieldItems, setFieldItems] = useState<ServiceOrderItem[]>([]);

  // Múltiplas balanças por OS
  const [soEquipments, setSoEquipments] = useState<(ServiceOrderEquipment & { equipment?: Equipment })[]>([]);
  const [clientEquipments, setClientEquipments] = useState<Equipment[]>([]);
  const [isAddingEquip, setIsAddingEquip] = useState(false);
  const [selectedEquipId, setSelectedEquipId] = useState('');
  const [newEquipNotes, setNewEquipNotes] = useState('');
  const [addingEquipLoading, setAddingEquipLoading] = useState(false);
  const [equipActionError, setEquipActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!osId || !activeCompany) {
      setOrder(null);
      setFieldExecution(null);
      setFieldAttachments([]);
      setFieldSignatures([]);
      setFieldItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    Promise.all([
      supabase
        .from('service_orders')
        .select(
          `
          *,
          client:clients(id, name, trade_name, document_number, phone),
          unit:client_units(id, unit_name, street, street_number, city, state),
          equipment:equipments(id, brand, model, serial_number, capacity_label, asset_tag),
          primary_technician:technicians!fk_os_primary_technician_tenant(id, full_name, calendar_color, phone),
          assignments:service_order_assignments(
            id, technician_id, assignment_role, is_active,
            technician:technicians(id, full_name, calendar_color, phone)
          )
        `
        )
        .eq('id', osId)
        .eq('company_id', activeCompany.id)
        .maybeSingle(),
      supabase
        .from('service_order_history')
        .select('*')
        .eq('service_order_id', osId)
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('service_order_items')
        .select('*')
        .eq('service_order_id', osId)
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: true }),
      permissions.canAssignTechnicians
        ? supabase
            .from('technicians')
            .select('*')
            .eq('company_id', activeCompany.id)
            .eq('is_active', true)
            .order('full_name', { ascending: true })
        : Promise.resolve({ data: [] as Technician[], error: null }),
      supabase
        .from('service_order_equipments')
        .select(`
          id,
          company_id,
          service_order_id,
          equipment_id,
          is_primary,
          notes,
          equipment:equipments(*)
        `)
        .eq('service_order_id', osId)
        .eq('company_id', activeCompany.id),
    ]).then(async ([osRes, histRes, itemsRes, techsRes, soEquipsRes]) => {
      if (cancelled) return;

      if (osRes.error) {
        setError(translateSupabaseError(osRes.error));
      } else if (!osRes.data) {
        setError(
          'Ordem de serviço não encontrada ou bloqueada pelas políticas RLS para o seu perfil.'
        );
      } else {
        const loaded = osRes.data as unknown as ServiceOrder;
        setOrder(loaded);
        setNextStatus(loaded.status);
        setNextPrimaryTechId(loaded.primary_technician_id ?? '');
        setAllowSharedTechView(loaded.allow_company_technicians_view);

        // Carrega outras balanças cadastradas para o cliente desta OS
        if (loaded.client_id) {
          const { data: clEquips } = await supabase
            .from('equipments')
            .select('*')
            .eq('client_id', loaded.client_id)
            .eq('company_id', activeCompany.id)
            .order('model', { ascending: true });
          if (clEquips) setClientEquipments(clEquips as Equipment[]);
        }
      }

      setHistory((histRes.data as ServiceOrderHistoryItem[]) ?? []);
      setFieldItems((itemsRes.data as ServiceOrderItem[]) ?? []);
      setTechnicians((techsRes.data as Technician[]) ?? []);
      setSoEquipments((soEquipsRes.data as any[]) ?? []);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [osId, activeCompany, permissions.canAssignTechnicians, reloadKey]);

  const handleSaveManagementChanges = async () => {
    if (!order || !activeCompany) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const updates: Record<string, unknown> = {
      status: nextStatus,
    };

    if (nextStatus === 'in_progress' && !order.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (nextStatus === 'completed' && !order.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    if (nextStatus === 'cancelled' && !order.cancelled_at) {
      updates.cancelled_at = new Date().toISOString();
    }

    if (permissions.canAssignTechnicians) {
      updates.primary_technician_id = nextPrimaryTechId || null;
      updates.allow_company_technicians_view = allowSharedTechView;
    }

    const { error: updErr } = await supabase
      .from('service_orders')
      .update(updates)
      .eq('id', order.id)
      .eq('company_id', activeCompany.id);

    setSaving(false);

    if (updErr) {
      setError(translateSupabaseError(updErr));
      return;
    }

    setSuccessMsg('Ordem de serviço atualizada no banco de dados.');
    onUpdated();
  };

  const handleAddScaleToOS = async () => {
    if (!order || !activeCompany || !selectedEquipId) return;
    setAddingEquipLoading(true);
    setEquipActionError(null);

    const { error: insErr } = await supabase.from('service_order_equipments').insert({
      company_id: activeCompany.id,
      service_order_id: order.id,
      equipment_id: selectedEquipId,
      is_primary: false,
      notes: newEquipNotes.trim() || null,
    });

    setAddingEquipLoading(false);
    if (insErr) {
      setEquipActionError(translateSupabaseError(insErr));
      return;
    }

    setIsAddingEquip(false);
    setSelectedEquipId('');
    setNewEquipNotes('');
    setReloadKey((k) => k + 1);
    onUpdated();
  };

  const handleRemoveScaleFromOS = async (linkId: string) => {
    if (!activeCompany) return;
    const { error: delErr } = await supabase
      .from('service_order_equipments')
      .delete()
      .eq('id', linkId)
      .eq('company_id', activeCompany.id);

    if (delErr) {
      setEquipActionError(translateSupabaseError(delErr));
      return;
    }
    setReloadKey((k) => k + 1);
    onUpdated();
  };

  const handleShareWhatsApp = () => {
    if (!order) return;
    const clientName = order.client?.trade_name || order.client?.name || 'Cliente';
    const equip = order.equipment
      ? `${order.equipment.brand} ${order.equipment.model} (Série: ${order.equipment.serial_number})`
      : 'Equipamento a identificar';

    let msg = `*EA BALANÇAS — Ordem de Serviço #${order.order_number}*\n`;
    msg += `*Cliente:* ${clientName}\n`;
    msg += `*Equipamento:* ${equip}\n`;
    msg += `*Defeito/Solicitação:* ${order.reported_issue}\n`;
    msg += `*Status:* ${order.status.toUpperCase()}\n`;
    if (order.primary_technician) {
      msg += `*Técnico Responsável:* ${order.primary_technician.full_name}\n`;
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const osLink = `${origin}/tecnico/os/${order.id}`;
    msg += `\n*Link de Acesso Direto à OS:*\n${osLink}\n`;

    const url = buildWhatsAppUrl(order.client?.phone, msg);
    window.open(url, '_blank');
  };

  return (
    <Modal
      isOpen={Boolean(osId)}
      onClose={onClose}
      title={
        order ? `${order.order_number} — ${order.title}` : 'Detalhes da Ordem de Serviço'
      }
      subtitle={
        order ? `Tipo: ${OS_TYPE_LABELS[order.order_type]}` : 'Consultando registro...'
      }
      maxWidthClass="max-w-3xl"
      footer={
        <>
          {order && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleShareWhatsApp}
              leftIcon={<Share2 className="w-3.5 h-3.5 text-emerald-600" />}
              className="mr-auto text-emerald-800 border-emerald-300 hover:bg-emerald-50"
            >
              WhatsApp
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {order && permissions.canAssignTechnicians && (
            <Button isLoading={saving} onClick={handleSaveManagementChanges}>
              Salvar Alterações
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">
          Carregando informações reais da Ordem de Serviço...
        </div>
      ) : error && !order ? (
        <AlertBanner variant="error" message={error} />
      ) : order ? (
        <div className="space-y-5">
          {error && <AlertBanner variant="error" message={error} />}
          {successMsg && <AlertBanner variant="success" message={successMsg} />}

          {/* Cabeçalho de Status e Prioridade */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-sm font-bold text-slate-900">
                {order.order_number}
              </span>
              <OSStatusBadge status={order.status} />
              <OSPriorityBadge priority={order.priority} />
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Aberta em{' '}
              {new Date(order.created_at).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </div>
          </div>

          {/* Dados do Cliente, Unidade e Balança */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-teal-600" />
                Cliente & Local de Atendimento
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {order.client?.trade_name || order.client?.name || 'Cliente'}
              </div>
              {order.client?.document_number && (
                <div className="text-xs text-slate-500 font-mono">
                  Doc.: {order.client.document_number}
                </div>
              )}
              {order.unit ? (
                <div className="text-xs text-slate-600 pt-1">
                  <strong>{order.unit.unit_name}:</strong> {order.unit.street}
                  {order.unit.street_number ? `, ${order.unit.street_number}` : ''} —{' '}
                  {order.unit.city}/{order.unit.state}
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  Unidade específica não informada
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-teal-600" />
                Balança Principal
              </div>
              {order.equipment ? (
                <>
                  <div className="text-sm font-semibold text-slate-900 flex items-center justify-between">
                    <span>{order.equipment.brand} {order.equipment.model}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">
                      Principal
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 font-mono">
                    Nº Série: {order.equipment.serial_number}
                    {order.equipment.asset_tag
                      ? ` • TAG: ${order.equipment.asset_tag}`
                      : ''}
                  </div>
                  {order.equipment.capacity_label && (
                    <div className="text-xs text-slate-500">
                      Capacidade: {order.equipment.capacity_label}
                    </div>
                  )}
                  {order.equipment.inmetro_ordinance && (
                    <div className="text-[11px] text-teal-800 font-medium pt-0.5">
                      {order.equipment.inmetro_ordinance}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-slate-400 pt-1">
                  Nenhum equipamento específico selecionado na abertura.
                </div>
              )}
            </div>
          </div>

          {/* MÚLTIPLAS BALANÇAS POR ORDEM DE SERVIÇO */}
          <div className="p-4 rounded-xl border border-slate-200/90 bg-white space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-teal-700" />
                <span>
                  Balanças Atendidas Nesta OS ({1 + soEquipments.filter((e) => !e.is_primary && e.equipment_id !== order.equipment_id).length})
                </span>
              </div>
              {!['completed', 'cancelled'].includes(order.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => setIsAddingEquip(!isAddingEquip)}
                  className="text-[11px] h-7 px-2.5 text-teal-700 border-teal-300 hover:bg-teal-50"
                >
                  {isAddingEquip ? 'Fechar' : '+ Vincular Outra Balança'}
                </Button>
              )}
            </div>

            {/* Lista de Balanças Adicionais */}
            {soEquipments.filter((e) => !e.is_primary && e.equipment_id !== order.equipment_id).length === 0 && !isAddingEquip ? (
              <p className="text-[11px] text-slate-500 italic">
                Apenas a balança principal está vinculada a esta visita. Clique acima para incluir outros equipamentos do mesmo cliente.
              </p>
            ) : (
              <div className="space-y-2">
                {soEquipments
                  .filter((e) => !e.is_primary && e.equipment_id !== order.equipment_id)
                  .map((seq) => (
                    <div
                      key={seq.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">
                            {seq.equipment?.brand} {seq.equipment?.model || 'Balança Adicional'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                            Adicional
                          </span>
                        </div>
                        <div className="text-slate-600 font-mono text-[11px]">
                          Série: {seq.equipment?.serial_number || 'S/N'} • Cap.: {seq.equipment?.capacity_label || 'N/A'}
                        </div>
                        {seq.equipment?.inmetro_ordinance && (
                          <div className="text-[11px] text-teal-800 font-medium">
                            {seq.equipment.inmetro_ordinance}
                          </div>
                        )}
                        {seq.notes && (
                          <div className="text-slate-500 italic text-[11px]">Obs: {seq.notes}</div>
                        )}
                      </div>

                      {!['completed', 'cancelled'].includes(order.status) && (
                        <button
                          type="button"
                          onClick={() => handleRemoveScaleFromOS(seq.id)}
                          className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          title="Desvincular balança desta OS"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {/* Painel Inline para Adicionar Balança */}
            {isAddingEquip && (
              <div className="p-3.5 bg-slate-50/90 rounded-xl space-y-3 border border-slate-300">
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-teal-600" />
                  <span>Vincular Balança do Cliente à OS</span>
                </div>

                {equipActionError && (
                  <div className="text-xs text-red-700 bg-red-50 p-2 rounded-lg border border-red-200">
                    {equipActionError}
                  </div>
                )}

                <SelectField
                  label="Selecione a Balança Adicional"
                  value={selectedEquipId}
                  onChange={(e) => setSelectedEquipId(e.target.value)}
                >
                  <option value="">-- Escolha uma balança cadastrada deste cliente --</option>
                  {clientEquipments
                    .filter(
                      (eq) =>
                        eq.id !== order.equipment_id &&
                        !soEquipments.some((s) => s.equipment_id === eq.id)
                    )
                    .map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.brand} {eq.model} (Série: {eq.serial_number}) {eq.capacity_label ? `• ${eq.capacity_label}` : ''}
                      </option>
                    ))}
                </SelectField>

                <InputField
                  label="Observações para Esta Balança (Opcional)"
                  placeholder="Ex: Verificar prato, pés niveladores e conferir calibração"
                  value={newEquipNotes}
                  onChange={(e) => setNewEquipNotes(e.target.value)}
                />

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => setIsAddingEquip(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    isLoading={addingEquipLoading}
                    disabled={!selectedEquipId}
                    onClick={handleAddScaleToOS}
                  >
                    Confirmar Vínculo
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Escopo / Defeito relatado */}
          <div className="p-4 rounded-xl border border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-800">
              Defeito Relatado / Solicitação do Cliente
            </div>
            <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
              {order.reported_issue}
            </p>
            {order.internal_notes && (
              <div className="pt-2 mt-2 border-t border-slate-100 text-xs text-slate-600">
                <strong className="text-slate-700">Notas internas:</strong>{' '}
                {order.internal_notes}
              </div>
            )}
            {order.scheduled_start && (
              <div className="pt-2 flex items-center gap-2 text-xs text-sky-800 font-medium">
                <Calendar className="w-3.5 h-3.5" />
                Agendado para:{' '}
                {new Date(order.scheduled_start).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
                {order.scheduled_end &&
                  ` até ${new Date(order.scheduled_end).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`}
              </div>
            )}
          </div>

          {/* Execução em Campo — Etapa 2 (Deslocamento, Check-in GPS, Checklist & Diagnóstico) */}
          {activeCompany && (
            <ServiceOrderFieldExecutionSection
              order={order}
              companyId={activeCompany.id}
              onExecutionChanged={setFieldExecution}
              onOrderUpdated={() => {
                setReloadKey((k) => k + 1);
                onUpdated();
              }}
            />
          )}

          {/* Fotos do Atendimento — Etapa 3 (Antes, Depois, Lacres em Bucket Privado) */}
          {activeCompany && (
            <ServiceOrderPhotosSection
              order={order}
              companyId={activeCompany.id}
              executionId={fieldExecution?.id}
              onAttachmentsChanged={setFieldAttachments}
            />
          )}

          {/* Peças e Serviços da OS — Catálogo Integrado */}
          {activeCompany && (
            <ServiceOrderItemsSection
              serviceOrderId={order.id}
              companyId={activeCompany.id}
              equipmentId={order.equipment_id}
            />
          )}

          {/* Assinatura Digital do Cliente — Etapa 3 */}
          {activeCompany && (
            <ServiceOrderSignatureSection
              order={order}
              companyId={activeCompany.id}
              executionId={fieldExecution?.id}
              onSignaturesChanged={setFieldSignatures}
            />
          )}

          {/* Fechamento Obrigatório, Revisão e Relatório PDF Profissional — Etapa 3 */}
          {activeCompany && (
            <ServiceOrderClosureAndPdfSection
              order={order}
              companyId={activeCompany.id}
              execution={fieldExecution}
              attachments={fieldAttachments}
              signatures={fieldSignatures}
              items={fieldItems}
              onOrderUpdated={() => {
                setReloadKey((k) => k + 1);
                onUpdated();
              }}
            />
          )}

          {/* Gestão Administrativa de Status e Atribuição (Exclusivo Gestor) */}
          {permissions.canAssignTechnicians && (
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
              <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-teal-700" />
                Controle Administrativo de Status e Atribuição Técnica
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField
                  label="Status Atual da OS"
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as OSStatus)}
                >
                  <option value="open">Aberta</option>
                  <option value="scheduled">Agendada</option>
                  <option value="in_progress">Em Execução</option>
                  <option value="completed">Concluída</option>
                  <option value="cancelled">Cancelada</option>
                </SelectField>

                <SelectField
                  label="Técnico Principal Atribuído"
                  value={nextPrimaryTechId}
                  onChange={(e) => setNextPrimaryTechId(e.target.value)}
                >
                  <option value="">Sem técnico atribuído</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </SelectField>
              </div>

              <CheckboxField
                label="Permitir visualização compartilhada com outros técnicos da empresa"
                description="Quando desmarcado, somente os técnicos atribuídos acima enxergam esta OS no banco (RLS)."
                checked={allowSharedTechView}
                onChange={(e) => setAllowSharedTechView(e.target.checked)}
              />
            </div>
          )}

          {/* Histórico Real de Alterações (service_order_history) */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <History className="w-4 h-4 text-slate-500" />
              Histórico Auditável da Ordem de Serviço ({history.length})
            </div>
            {history.length === 0 ? (
              <div className="text-xs text-slate-400 italic">
                Nenhum evento registrado ainda.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-44 overflow-y-auto">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2 text-slate-700">
                      <ShieldCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                      <span>{h.description}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                      {new Date(h.created_at).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
};
