import React, { useState, useEffect } from 'react';
import { Sliders } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { InputField, SelectField } from '../ui/FormField';
import type { Company, Plan, SubscriptionStatus, PlanLimits } from '../../types/database';
import {
  fetchCompanySubscription,
  updateCompanySubscription,
  fetchCompanyOverride,
  saveCompanyOverride,
  removeCompanyOverride,
} from '../../lib/plans';
import { translateSupabaseError } from '../../lib/errors';

interface CompanySubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  company: Company | null;
  availablePlans: Plan[];
}

export const CompanySubscriptionModal: React.FC<CompanySubscriptionModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  company,
  availablePlans,
}) => {
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus>('active');
  const [notes, setNotes] = useState('');

  // Overrides
  const [enableCustomOverrides, setEnableCustomOverrides] = useState(false);
  const [customTechs, setCustomTechs] = useState('');
  const [customClients, setCustomClients] = useState('');
  const [customEquipments, setCustomEquipments] = useState('');
  const [customUsers, setCustomUsers] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !company) return;

    setErrorMsg(null);
    setFetching(true);

    Promise.all([
      fetchCompanySubscription(company.id),
      fetchCompanyOverride(company.id),
    ])
      .then(([sub, override]) => {
        if (sub) {
          setSelectedPlanId(sub.plan_id);
          setStatus(sub.status);
          setNotes(sub.notes || '');
        } else if (availablePlans.length > 0) {
          setSelectedPlanId(availablePlans[0].id);
          setStatus('active');
          setNotes('');
        }

        if (override) {
          setEnableCustomOverrides(true);
          setCustomTechs(override.override_limits?.max_technicians !== undefined && override.override_limits?.max_technicians !== null ? String(override.override_limits.max_technicians) : '');
          setCustomClients(override.override_limits?.max_clients !== undefined && override.override_limits?.max_clients !== null ? String(override.override_limits.max_clients) : '');
          setCustomEquipments(override.override_limits?.max_equipments !== undefined && override.override_limits?.max_equipments !== null ? String(override.override_limits.max_equipments) : '');
          setCustomUsers(override.override_limits?.max_users !== undefined && override.override_limits?.max_users !== null ? String(override.override_limits.max_users) : '');
          setOverrideReason(override.reason || '');
        } else {
          setEnableCustomOverrides(false);
          setCustomTechs('');
          setCustomClients('');
          setCustomEquipments('');
          setCustomUsers('');
          setOverrideReason('');
        }
      })
      .catch((err) => {
        setErrorMsg(translateSupabaseError(err));
      })
      .finally(() => {
        setFetching(false);
      });
  }, [isOpen, company, availablePlans]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company || !selectedPlanId) return;

    if (enableCustomOverrides && !overrideReason.trim()) {
      setErrorMsg('Informe a justificativa/motivo comercial para as configurações personalizadas desta empresa.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Atualiza a assinatura
      await updateCompanySubscription(company.id, selectedPlanId, status, notes);

      // 2. Trata sobrescritas
      if (enableCustomOverrides) {
        const limits: Partial<PlanLimits> = {};
        if (customTechs.trim()) limits.max_technicians = Number(customTechs);
        if (customClients.trim()) limits.max_clients = Number(customClients);
        if (customEquipments.trim()) limits.max_equipments = Number(customEquipments);
        if (customUsers.trim()) limits.max_users = Number(customUsers);

        await saveCompanyOverride(company.id, limits, {}, overrideReason);
      } else {
        await removeCompanyOverride(company.id);
      }

      onSuccess();
      onClose();
    } catch (err) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Gerenciar Plano & Assinatura — ${company?.name || ''}`}
      maxWidthClass="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {fetching ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Carregando dados da assinatura...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField
                label="Plano Selecionado"
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                required
              >
                {availablePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (R$ {Number(p.price).toFixed(2)}/mês)
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Status da Assinatura"
                value={status}
                onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
                required
              >
                <option value="active">Ativa</option>
                <option value="trialing">Em Teste (Trial)</option>
                <option value="past_due">Pagamento Pendente</option>
                <option value="suspended">Suspensa</option>
                <option value="canceled">Cancelada</option>
              </SelectField>
            </div>

            <InputField
              label="Notas Internas da Assinatura"
              placeholder="Ex: Contrato assinado em 10/2026, faturamento manual por boleto"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* Seção de Customização / Override */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-teal-600" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Sobrescrita Individual de Limites (Custom)
                  </span>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableCustomOverrides}
                    onChange={(e) => setEnableCustomOverrides(e.target.checked)}
                    className="rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>Habilitar Sobrescrita</span>
                </label>
              </div>

              {enableCustomOverrides && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <InputField
                      label="Limite Técnicos"
                      type="number"
                      placeholder="Padrão do plano"
                      value={customTechs}
                      onChange={(e) => setCustomTechs(e.target.value)}
                    />
                    <InputField
                      label="Limite Usuários"
                      type="number"
                      placeholder="Padrão do plano"
                      value={customUsers}
                      onChange={(e) => setCustomUsers(e.target.value)}
                    />
                    <InputField
                      label="Limite Clientes"
                      type="number"
                      placeholder="Padrão do plano"
                      value={customClients}
                      onChange={(e) => setCustomClients(e.target.value)}
                    />
                    <InputField
                      label="Limite Balanças"
                      type="number"
                      placeholder="Padrão do plano"
                      value={customEquipments}
                      onChange={(e) => setCustomEquipments(e.target.value)}
                    />
                  </div>

                  <InputField
                    label="Justificativa da Sobrescrita (Audit Trail Obrigatório)"
                    placeholder="Ex: Negociação especial com a diretoria da EA Balanças - Matriz"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    required
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={loading}>
                {loading ? 'Salvando...' : 'Salvar Assinatura'}
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
};
