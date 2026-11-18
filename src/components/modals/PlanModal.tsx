import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { InputField, CheckboxField, SelectField } from '../ui/FormField';
import type { Plan, PlanFeatures, BillingCycle } from '../../types/database';
import { createPlan, updatePlan, type PlanPayload } from '../../lib/plans';
import { translateSupabaseError } from '../../lib/errors';

interface PlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  planToEdit?: Plan | null;
}

const DEFAULT_FEATURES: PlanFeatures = {
  stock: true,
  multi_scale_os: true,
  gps_routing: true,
  pdf_reports: true,
  signatures: true,
  photos: true,
  custom_logo: true,
  api_access: false,
};

export const PlanModal: React.FC<PlanModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  planToEdit,
}) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(197);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [trialDays, setTrialDays] = useState(14);
  const [isActive, setIsActive] = useState(true);
  const [isPublic, setIsPublic] = useState(true);
  const [sortOrder, setSortOrder] = useState(1);

  // Limites (vazio ou 0 = ilimitado)
  const [maxTechs, setMaxTechs] = useState<string>('5');
  const [maxUsers, setMaxUsers] = useState<string>('10');
  const [maxClients, setMaxClients] = useState<string>('500');
  const [maxEquipments, setMaxEquipments] = useState<string>('1000');
  const [maxMonthlyOs, setMaxMonthlyOs] = useState<string>('100');

  // Módulos
  const [features, setFeatures] = useState<PlanFeatures>(DEFAULT_FEATURES);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (planToEdit) {
      setName(planToEdit.name);
      setSlug(planToEdit.slug);
      setDescription(planToEdit.description || '');
      setPrice(planToEdit.price);
      setBillingCycle(planToEdit.billing_cycle);
      setTrialDays(planToEdit.trial_days);
      setIsActive(planToEdit.is_active);
      setIsPublic(planToEdit.is_public);
      setSortOrder(planToEdit.sort_order);
      setMaxTechs(planToEdit.max_technicians !== null ? String(planToEdit.max_technicians) : '');
      setMaxUsers(planToEdit.max_users !== null ? String(planToEdit.max_users) : '');
      setMaxClients(planToEdit.max_clients !== null ? String(planToEdit.max_clients) : '');
      setMaxEquipments(planToEdit.max_equipments !== null ? String(planToEdit.max_equipments) : '');
      setMaxMonthlyOs(planToEdit.max_monthly_os !== null ? String(planToEdit.max_monthly_os) : '');
      setFeatures({ ...DEFAULT_FEATURES, ...(planToEdit.features || {}) });
    } else {
      setName('');
      setSlug('');
      setDescription('');
      setPrice(197);
      setBillingCycle('monthly');
      setTrialDays(14);
      setIsActive(true);
      setIsPublic(true);
      setSortOrder(1);
      setMaxTechs('5');
      setMaxUsers('10');
      setMaxClients('500');
      setMaxEquipments('1000');
      setMaxMonthlyOs('100');
      setFeatures(DEFAULT_FEATURES);
    }
    setErrorMsg(null);
  }, [planToEdit, isOpen]);

  const handleFeatureToggle = (key: keyof PlanFeatures) => {
    setFeatures((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanName = name.trim();
    const cleanSlug = (slug || cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')).trim();

    if (!cleanName) {
      setErrorMsg('Informe o nome do plano.');
      return;
    }

    setLoading(true);

    const payload: PlanPayload = {
      name: cleanName,
      slug: cleanSlug,
      description: description.trim() || undefined,
      price: Number(price) || 0,
      billing_cycle: billingCycle,
      trial_days: Number(trialDays) || 0,
      is_active: isActive,
      is_public: isPublic,
      sort_order: Number(sortOrder) || 1,
      max_technicians: maxTechs ? Number(maxTechs) : null,
      max_users: maxUsers ? Number(maxUsers) : null,
      max_clients: maxClients ? Number(maxClients) : null,
      max_equipments: maxEquipments ? Number(maxEquipments) : null,
      max_monthly_os: maxMonthlyOs ? Number(maxMonthlyOs) : null,
      features,
    };

    try {
      if (planToEdit) {
        await updatePlan(planToEdit.id, payload);
      } else {
        await createPlan(payload);
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
      title={planToEdit ? `Editar Plano: ${planToEdit.name}` : 'Criar Novo Plano de Assinatura'}
      maxWidthClass="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InputField
            label="Nome do Plano"
            placeholder="Ex: Metrion Avançado"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!planToEdit && !slug) {
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
              }
            }}
            required
          />

          <InputField
            label="Slug Identificador"
            placeholder="ex: avancado"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
          />
        </div>

        <InputField
          label="Descrição Comercial"
          placeholder="Resumo dos diferenciais e público-alvo deste plano"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InputField
            label="Preço Regular (R$)"
            type="number"
            step="0.01"
            value={String(price)}
            onChange={(e) => setPrice(Number(e.target.value))}
            required
          />

          <SelectField
            label="Periodicidade"
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
          >
            <option value="monthly">Mensal</option>
            <option value="quarterly">Trimestral</option>
            <option value="semiannual">Semestral</option>
            <option value="annual">Anual</option>
          </SelectField>

          <InputField
            label="Dias de Teste (Trial)"
            type="number"
            value={String(trialDays)}
            onChange={(e) => setTrialDays(Number(e.target.value))}
          />
        </div>

        {/* Limites de Recursos */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-2">
            Limites Operacionais do Plano (deixe vazio para ilimitado)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            <InputField
              label="Técnicos"
              type="number"
              placeholder="Ilimitado"
              value={maxTechs}
              onChange={(e) => setMaxTechs(e.target.value)}
            />
            <InputField
              label="Usuários"
              type="number"
              placeholder="Ilimitado"
              value={maxUsers}
              onChange={(e) => setMaxUsers(e.target.value)}
            />
            <InputField
              label="Clientes"
              type="number"
              placeholder="Ilimitado"
              value={maxClients}
              onChange={(e) => setMaxClients(e.target.value)}
            />
            <InputField
              label="Balanças"
              type="number"
              placeholder="Ilimitado"
              value={maxEquipments}
              onChange={(e) => setMaxEquipments(e.target.value)}
            />
            <InputField
              label="OS / Mês"
              type="number"
              placeholder="Ilimitado"
              value={maxMonthlyOs}
              onChange={(e) => setMaxMonthlyOs(e.target.value)}
            />
          </div>
        </div>

        {/* Módulos e Funcionalidades Habilitadas */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-2">
            Módulos e Recursos Liberados no Plano
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.stock}
                onChange={() => handleFeatureToggle('stock')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">Módulo de Estoque & Peças</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.multi_scale_os}
                onChange={() => handleFeatureToggle('multi_scale_os')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">Múltiplas Balanças por OS</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.gps_routing}
                onChange={() => handleFeatureToggle('gps_routing')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">Roteamento GPS (Waze/Maps)</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.pdf_reports}
                onChange={() => handleFeatureToggle('pdf_reports')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">Relatórios PDF de OS</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.signatures}
                onChange={() => handleFeatureToggle('signatures')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">Assinatura Digital em Campo</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.photos}
                onChange={() => handleFeatureToggle('photos')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">Fotos Antes/Depois (Storage)</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.custom_logo}
                onChange={() => handleFeatureToggle('custom_logo')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">White-label / Logotipo Próprio</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={features.api_access}
                onChange={() => handleFeatureToggle('api_access')}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">Acesso via API Rest</span>
            </label>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-4 pt-2">
          <CheckboxField
            label="Plano Ativo"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <CheckboxField
            label="Visível Publicamente"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Salvando...' : planToEdit ? 'Atualizar Plano' : 'Criar Plano'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
