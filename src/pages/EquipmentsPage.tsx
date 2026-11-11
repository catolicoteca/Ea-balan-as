import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Scale, Plus, Search, Edit3 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import { equipmentSchema, zodErrorsToMap } from '../lib/validation';
import type {
  Client,
  ClientUnit,
  Equipment,
  EquipmentStatus,
} from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EquipmentStatusBadge } from '../components/ui/Badge';
import {
  InputField,
  SelectField,
  TextareaField,
} from '../components/ui/FormField';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';

export const EquipmentsPage: React.FC = () => {
  const { activeCompany, user, permissions } = useAuthTenant();
  const [searchParams] = useSearchParams();

  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [units, setUnits] = useState<ClientUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEquip, setEditingEquip] = useState<Equipment | null>(null);

  const [clientId, setClientId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [equipmentType, setEquipmentType] = useState('Balança de Plataforma');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [inmetroNumber, setInmetroNumber] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [accuracyClass, setAccuracyClass] = useState<'I' | 'II' | 'III' | 'IIII' | 'N/A'>('III');
  const [capacityLabel, setCapacityLabel] = useState('');
  const [divisionLabel, setDivisionLabel] = useState('');
  const [sectorLocation, setSectorLocation] = useState('');
  const [lastCalib, setLastCalib] = useState('');
  const [nextCalib, setNextCalib] = useState('');
  const [status, setStatus] = useState<EquipmentStatus>('active');
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);

    const [eqRes, clRes] = await Promise.all([
      supabase
        .from('equipments')
        .select(
          '*, client:clients(id, name, trade_name), unit:client_units(id, unit_name, city, state)'
        )
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: false }),
      permissions.canManageEquipments
        ? supabase
            .from('clients')
            .select('*')
            .eq('company_id', activeCompany.id)
            .eq('is_active', true)
            .order('name', { ascending: true })
        : Promise.resolve({ data: [] as Client[], error: null }),
    ]);

    if (eqRes.error) {
      setError(translateSupabaseError(eqRes.error));
      setEquipments([]);
    } else {
      setEquipments((eqRes.data as unknown as Equipment[]) ?? []);
    }

    setClients((clRes.data as Client[]) ?? []);
    setLoading(false);
  }, [activeCompany, permissions.canManageEquipments]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!activeCompany || !clientId) {
      setUnits([]);
      return;
    }
    supabase
      .from('client_units')
      .select('*')
      .eq('company_id', activeCompany.id)
      .eq('client_id', clientId)
      .eq('is_active', true)
      .then(({ data }) => {
        setUnits((data as ClientUnit[]) ?? []);
      });
  }, [activeCompany, clientId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return equipments;
    return equipments.filter(
      (e) =>
        e.serial_number.toLowerCase().includes(q) ||
        e.brand.toLowerCase().includes(q) ||
        e.model.toLowerCase().includes(q) ||
        (e.asset_tag ?? '').toLowerCase().includes(q) ||
        (e.client?.name ?? '').toLowerCase().includes(q) ||
        (e.client?.trade_name ?? '').toLowerCase().includes(q)
    );
  }, [equipments, search]);

  const openNew = () => {
    setEditingEquip(null);
    setClientId(clients[0]?.id ?? '');
    setUnitId('');
    setEquipmentType('Balança de Plataforma');
    setBrand('');
    setModel('');
    setSerialNumber('');
    setAssetTag('');
    setInmetroNumber('');
    setSealNumber('');
    setAccuracyClass('III');
    setCapacityLabel('');
    setDivisionLabel('');
    setSectorLocation('');
    setLastCalib('');
    setNextCalib('');
    setStatus('active');
    setNotes('');
    setFieldErrors({});
    setSubmitErr(null);
    setModalOpen(true);
  };

  const openEdit = (eq: Equipment) => {
    setEditingEquip(eq);
    setClientId(eq.client_id);
    setUnitId(eq.unit_id ?? '');
    setEquipmentType(eq.equipment_type);
    setBrand(eq.brand);
    setModel(eq.model);
    setSerialNumber(eq.serial_number);
    setAssetTag(eq.asset_tag ?? '');
    setInmetroNumber(eq.inmetro_number ?? '');
    setSealNumber(eq.seal_number ?? '');
    setAccuracyClass(eq.accuracy_class ?? 'III');
    setCapacityLabel(eq.capacity_label ?? '');
    setDivisionLabel(eq.division_label ?? '');
    setSectorLocation(eq.sector_location ?? '');
    setLastCalib(eq.last_calibration_date ?? '');
    setNextCalib(eq.next_calibration_date ?? '');
    setStatus(eq.status);
    setNotes(eq.notes ?? '');
    setFieldErrors({});
    setSubmitErr(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;

    setFieldErrors({});
    setSubmitErr(null);

    const parsed = equipmentSchema.safeParse({
      client_id: clientId,
      unit_id: unitId || undefined,
      equipment_type: equipmentType,
      brand,
      model,
      serial_number: serialNumber,
      asset_tag: assetTag || undefined,
      inmetro_number: inmetroNumber || undefined,
      seal_number: sealNumber || undefined,
      accuracy_class: accuracyClass,
      capacity_label: capacityLabel || undefined,
      division_label: divisionLabel || undefined,
      sector_location: sectorLocation || undefined,
      last_calibration_date: lastCalib || undefined,
      next_calibration_date: nextCalib || undefined,
      status,
      notes: notes || undefined,
    });

    if (!parsed.success) {
      setFieldErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setSaving(true);
    const payload = {
      company_id: activeCompany.id,
      client_id: parsed.data.client_id,
      unit_id: parsed.data.unit_id || null,
      equipment_type: parsed.data.equipment_type,
      brand: parsed.data.brand,
      model: parsed.data.model,
      serial_number: parsed.data.serial_number,
      asset_tag: parsed.data.asset_tag || null,
      inmetro_number: parsed.data.inmetro_number || null,
      seal_number: parsed.data.seal_number || null,
      accuracy_class: parsed.data.accuracy_class,
      capacity_label: parsed.data.capacity_label || null,
      division_label: parsed.data.division_label || null,
      sector_location: parsed.data.sector_location || null,
      last_calibration_date: parsed.data.last_calibration_date || null,
      next_calibration_date: parsed.data.next_calibration_date || null,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      ...(editingEquip ? {} : { created_by: user?.id ?? null }),
    };

    const res = editingEquip
      ? await supabase
          .from('equipments')
          .update(payload)
          .eq('id', editingEquip.id)
          .eq('company_id', activeCompany.id)
      : await supabase.from('equipments').insert(payload);

    setSaving(false);

    if (res.error) {
      setSubmitErr(translateSupabaseError(res.error));
      return;
    }

    setModalOpen(false);
    await loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Balanças / Equipamentos
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Inventário metrológico por cliente, número de série, lacre, classe de exatidão e calibração.
          </p>
        </div>

        {permissions.canManageEquipments && (
          <Button onClick={openNew} leftIcon={<Plus className="w-4 h-4" />}>
            Nova Balança / Equipamento
          </Button>
        )}
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      <Card noPadding>
        <div className="p-4 border-b border-slate-100">
          <div className="max-w-md relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nº de série, marca, modelo, TAG ou cliente..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Carregando parque de equipamentos...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Scale className="w-5 h-5" />}
            title="Nenhum equipamento encontrado"
            description={
              permissions.canManageEquipments
                ? 'Cadastre balanças e sistemas de pesagem vinculados aos clientes para rastrear calibrações e ordens de serviço.'
                : 'Nenhum equipamento vinculado às suas ordens de serviço no momento.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-5">Marca / Modelo</th>
                  <th className="py-3 px-4">Nº Série / Lacre</th>
                  <th className="py-3 px-4">Capacidade / Classe</th>
                  <th className="py-3 px-4">Cliente / Local</th>
                  <th className="py-3 px-4">Próx. Calibração</th>
                  <th className="py-3 px-4">Status</th>
                  {permissions.canManageEquipments && (
                    <th className="py-3 px-5 text-right">Ações</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((eq) => (
                  <tr key={eq.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-5">
                      <div className="font-semibold text-slate-900">
                        {eq.brand} {eq.model}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {eq.equipment_type}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <div className="font-semibold text-teal-800">
                        {eq.serial_number}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {eq.seal_number ? `Lacre: ${eq.seal_number}` : 'Sem lacre inf.'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-800">
                        {eq.capacity_label || '—'}
                        {eq.division_label ? ` × ${eq.division_label}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Classe {eq.accuracy_class || 'N/A'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900">
                        {eq.client?.trade_name || eq.client?.name || '—'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {eq.unit
                          ? `${eq.unit.unit_name} (${eq.unit.city}/${eq.unit.state})`
                          : eq.sector_location || '—'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 tabular-nums">
                      {eq.next_calibration_date
                        ? new Date(
                            `${eq.next_calibration_date}T12:00:00`
                          ).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="py-3.5 px-4">
                      <EquipmentStatusBadge status={eq.status} />
                    </td>
                    {permissions.canManageEquipments && (
                      <td className="py-3.5 px-5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(eq)}
                          leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                        >
                          Editar
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          editingEquip ? 'Editar Balança / Equipamento' : 'Cadastrar Balança / Equipamento'
        }
        subtitle="Dados técnicos e metrológicos do instrumento de pesagem"
        maxWidthClass="max-w-3xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="equip-form"
              isLoading={saving}
              disabled={clients.length === 0}
            >
              Salvar Equipamento
            </Button>
          </>
        }
      >
        <form id="equip-form" onSubmit={handleSave} className="space-y-4">
          {submitErr && <AlertBanner variant="error" message={submitErr} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SelectField
              label="Cliente Proprietário"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              error={fieldErrors.client_id}
            >
              <option value="">Selecione o cliente...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.trade_name || c.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Unidade / Planta"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={!clientId || units.length === 0}
            >
              <option value=""> Geral / Sem unidade específica </option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unit_name} ({u.city}/{u.state})
                </option>
              ))}
            </SelectField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SelectField
              label="Categoria"
              required
              value={equipmentType}
              onChange={(e) => setEquipmentType(e.target.value)}
            >
              <option value="Balança Rodoviária">Balança Rodoviária</option>
              <option value="Balança de Plataforma">Balança de Plataforma / Piso</option>
              <option value="Balança Comercial">Balança Comercial / Checkout</option>
              <option value="Balança Analítica / Precisão">
                Balança Analítica / Laboratório
              </option>
              <option value="Sistema de Dosagem / Ensacadeira">
                Sistema de Dosagem / Ensacadeira
              </option>
              <option value="Indicador / Célula de Carga">
                Indicador / Célula de Carga
              </option>
            </SelectField>

            <InputField
              label="Marca / Fabricante"
              required
              placeholder="Ex.: Toledo Prix, Filizola, Mettler"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              error={fieldErrors.brand}
            />

            <InputField
              label="Modelo"
              required
              placeholder="Ex.: 9091, Platina, IND570"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              error={fieldErrors.model}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <InputField
              label="Número de Série"
              required
              placeholder="S/N único"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              error={fieldErrors.serial_number}
            />
            <InputField
              label="Patrimônio / TAG"
              placeholder="Ex.: BAL-014"
              value={assetTag}
              onChange={(e) => setAssetTag(e.target.value)}
            />
            <InputField
              label="Nº Lacre Atual"
              placeholder="Lacre IPEM/Inmetro"
              value={sealNumber}
              onChange={(e) => setSealNumber(e.target.value)}
            />
            <InputField
              label="Nº Portaria Inmetro"
              placeholder="Ex.: 236/94"
              value={inmetroNumber}
              onChange={(e) => setInmetroNumber(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <InputField
              label="Capacidade Máx. (Max)"
              placeholder="Ex.: 1.500 kg ou 80 t"
              value={capacityLabel}
              onChange={(e) => setCapacityLabel(e.target.value)}
            />
            <InputField
              label="Divisão (d / e)"
              placeholder="Ex.: 200 g ou 10 kg"
              value={divisionLabel}
              onChange={(e) => setDivisionLabel(e.target.value)}
            />
            <SelectField
              label="Classe de Exatidão"
              value={accuracyClass}
              onChange={(e) =>
                setAccuracyClass(
                  e.target.value as 'I' | 'II' | 'III' | 'IIII' | 'N/A'
                )
              }
            >
              <option value="I">Classe I (Especial)</option>
              <option value="II">Classe II (Fina)</option>
              <option value="III">Classe III (Média)</option>
              <option value="IIII">Classe IIII (Ordinária)</option>
              <option value="N/A">N/A</option>
            </SelectField>
            <SelectField
              label="Status Operacional"
              value={status}
              onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
            >
              <option value="active">Em Operação</option>
              <option value="maintenance">Em Manutenção</option>
              <option value="inactive">Inativa</option>
              <option value="condemned">Interditada / Baixada</option>
            </SelectField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InputField
              label="Setor / Localização Interna"
              placeholder="Ex.: Recebimento Doca 03"
              value={sectorLocation}
              onChange={(e) => setSectorLocation(e.target.value)}
            />
            <InputField
              label="Última Calibração"
              type="date"
              value={lastCalib}
              onChange={(e) => setLastCalib(e.target.value)}
            />
            <InputField
              label="Próxima Calibração"
              type="date"
              value={nextCalib}
              onChange={(e) => setNextCalib(e.target.value)}
            />
          </div>

          <TextareaField
            label="Observações Técnicas"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </form>
      </Modal>
    </div>
  );
};
