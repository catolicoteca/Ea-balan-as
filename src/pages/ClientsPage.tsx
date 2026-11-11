import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  Plus,
  MapPin,
  Phone,
  Mail,
  Building2,
  Edit3,
  Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import {
  BRAZILIAN_STATES,
  clientSchema,
  clientUnitSchema,
  formatCEP,
  formatCNPJ,
  formatCPF,
  formatPhone,
  zodErrorsToMap,
} from '../lib/validation';
import type { Client, ClientUnit } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import {
  CheckboxField,
  InputField,
  SelectField,
  TextareaField,
} from '../components/ui/FormField';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';

export const ClientsPage: React.FC = () => {
  const { activeCompany, user, permissions } = useAuthTenant();
  const [searchParams] = useSearchParams();

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  // Modal de Cliente
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [docType, setDocType] = useState<'CNPJ' | 'CPF' | 'OUTRO'>('CNPJ');
  const [docNumber, setDocNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [clientSubmitErr, setClientSubmitErr] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);

  // Modal de Unidade / Endereço
  const [unitModalClient, setUnitModalClient] = useState<Client | null>(null);
  const [unitName, setUnitName] = useState('');
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('SP');
  const [postalCode, setPostalCode] = useState('');
  const [unitContact, setUnitContact] = useState('');
  const [unitPhone, setUnitPhone] = useState('');
  const [isPrimary, setIsPrimary] = useState(true);
  const [unitErrors, setUnitErrors] = useState<Record<string, string>>({});
  const [unitSubmitErr, setUnitSubmitErr] = useState<string | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);

  const loadClients = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);

    const { data, error: qErr } = await supabase
      .from('clients')
      .select('*, units:client_units(*)')
      .eq('company_id', activeCompany.id)
      .order('name', { ascending: true });

    if (qErr) {
      setError(translateSupabaseError(qErr));
      setClients([]);
    } else {
      setClients((data as unknown as Client[]) ?? []);
    }
    setLoading(false);
  }, [activeCompany]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.trade_name ?? '').toLowerCase().includes(q) ||
        (c.document_number ?? '').toLowerCase().includes(q) ||
        (c.contact_name ?? '').toLowerCase().includes(q)
    );
  }, [clients, search]);

  const openCreateClient = () => {
    setEditingClient(null);
    setName('');
    setTradeName('');
    setDocType('CNPJ');
    setDocNumber('');
    setContactName('');
    setEmail('');
    setPhone('');
    setNotes('');
    setClientErrors({});
    setClientSubmitErr(null);
    setClientModalOpen(true);
  };

  const openEditClient = (c: Client) => {
    setEditingClient(c);
    setName(c.name);
    setTradeName(c.trade_name ?? '');
    setDocType(c.document_type);
    setDocNumber(c.document_number ?? '');
    setContactName(c.contact_name ?? '');
    setEmail(c.email ?? '');
    setPhone(c.phone ?? '');
    setNotes(c.notes ?? '');
    setClientErrors({});
    setClientSubmitErr(null);
    setClientModalOpen(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;

    setClientErrors({});
    setClientSubmitErr(null);

    const parsed = clientSchema.safeParse({
      name,
      trade_name: tradeName || undefined,
      document_type: docType,
      document_number: docNumber || undefined,
      contact_name: contactName || undefined,
      email: email || undefined,
      phone: phone || undefined,
      notes: notes || undefined,
    });

    if (!parsed.success) {
      setClientErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setSavingClient(true);
    const payload = {
      company_id: activeCompany.id,
      name: parsed.data.name,
      trade_name: parsed.data.trade_name || null,
      document_type: parsed.data.document_type,
      document_number: parsed.data.document_number || null,
      contact_name: parsed.data.contact_name || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      notes: parsed.data.notes || null,
      ...(editingClient ? {} : { created_by: user?.id ?? null }),
    };

    const res = editingClient
      ? await supabase
          .from('clients')
          .update(payload)
          .eq('id', editingClient.id)
          .eq('company_id', activeCompany.id)
      : await supabase.from('clients').insert(payload);

    setSavingClient(false);

    if (res.error) {
      setClientSubmitErr(translateSupabaseError(res.error));
      return;
    }

    setClientModalOpen(false);
    await loadClients();
  };

  const openAddUnit = (client: Client) => {
    setUnitModalClient(client);
    setUnitName(client.units && client.units.length > 0 ? '' : 'Matriz');
    setStreet('');
    setStreetNumber('');
    setNeighborhood('');
    setCity('');
    setStateUf('SP');
    setPostalCode('');
    setUnitContact(client.contact_name ?? '');
    setUnitPhone(client.phone ?? '');
    setIsPrimary(!(client.units && client.units.length > 0));
    setUnitErrors({});
    setUnitSubmitErr(null);
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany || !unitModalClient) return;

    setUnitErrors({});
    setUnitSubmitErr(null);

    const parsed = clientUnitSchema.safeParse({
      unit_name: unitName,
      street,
      street_number: streetNumber || undefined,
      neighborhood: neighborhood || undefined,
      city,
      state: stateUf,
      postal_code: postalCode || undefined,
      contact_name: unitContact || undefined,
      contact_phone: unitPhone || undefined,
      is_primary: isPrimary,
    });

    if (!parsed.success) {
      setUnitErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setSavingUnit(true);
    const { error: uErr } = await supabase.from('client_units').insert({
      company_id: activeCompany.id,
      client_id: unitModalClient.id,
      unit_name: parsed.data.unit_name,
      street: parsed.data.street,
      street_number: parsed.data.street_number || null,
      neighborhood: parsed.data.neighborhood || null,
      city: parsed.data.city,
      state: parsed.data.state.toUpperCase(),
      postal_code: parsed.data.postal_code || null,
      contact_name: parsed.data.contact_name || null,
      contact_phone: parsed.data.contact_phone || null,
      is_primary: parsed.data.is_primary,
    });
    setSavingUnit(false);

    if (uErr) {
      setUnitSubmitErr(translateSupabaseError(uErr));
      return;
    }

    setUnitModalClient(null);
    await loadClients();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Clientes & Unidades
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Cadastro multiempresa de clientes e endereços operacionais de atendimento.
          </p>
        </div>

        {permissions.canManageClients && (
          <Button
            onClick={openCreateClient}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Novo Cliente
          </Button>
        )}
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      <Card>
        <div className="mb-4 max-w-md relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por razão social, nome fantasia ou CNPJ/CPF..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
          />
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Consultando clientes no banco de dados...
          </div>
        ) : filteredClients.length === 0 ? (
          <EmptyState
            icon={<Users className="w-5 h-5" />}
            title="Nenhum cliente encontrado"
            description={
              permissions.canManageClients
                ? 'Cadastre o primeiro cliente e suas unidades para vincular equipamentos e ordens de serviço.'
                : 'Nenhum cliente vinculado às ordens de serviço atribuídas ao seu perfil.'
            }
            action={
              permissions.canManageClients ? (
                <Button
                  size="sm"
                  onClick={openCreateClient}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  Cadastrar Primeiro Cliente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredClients.map((c) => {
              const units: ClientUnit[] = c.units ?? [];
              return (
                <div
                  key={c.id}
                  className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all bg-white flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {c.trade_name || c.name}
                        </h3>
                        {c.trade_name && (
                          <div className="text-xs text-slate-500">{c.name}</div>
                        )}
                      </div>
                      {c.document_number && (
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                          {c.document_type}: {c.document_number}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
                      {c.contact_name && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {c.contact_name}
                        </span>
                      )}
                      {c.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {c.phone}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {c.email}
                        </span>
                      )}
                    </div>

                    {/* Unidades do Cliente */}
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Unidades / Endereços ({units.length})
                      </div>
                      {units.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          Nenhuma unidade cadastrada ainda.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {units.map((u) => (
                            <div
                              key={u.id}
                              className="text-xs text-slate-600 flex items-start gap-1.5"
                            >
                              <MapPin className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                              <span>
                                <strong>{u.unit_name}:</strong> {u.street}
                                {u.street_number ? `, ${u.street_number}` : ''} —{' '}
                                {u.city}/{u.state}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {permissions.canManageClients && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openAddUnit(c)}
                        leftIcon={<MapPin className="w-3.5 h-3.5" />}
                      >
                        Nova Unidade
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditClient(c)}
                        leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                      >
                        Editar
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modal Cadastro/Edição de Cliente */}
      <Modal
        isOpen={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title={editingClient ? 'Editar Cliente' : 'Novo Cliente'}
        subtitle="Dados comerciais vinculados exclusivamente à empresa ativa"
        footer={
          <>
            <Button variant="outline" onClick={() => setClientModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="client-form"
              isLoading={savingClient}
            >
              Salvar Cliente
            </Button>
          </>
        }
      >
        <form id="client-form" onSubmit={handleSaveClient} className="space-y-4">
          {clientSubmitErr && (
            <AlertBanner variant="error" message={clientSubmitErr} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Razão Social / Nome Completo"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={clientErrors.name}
            />
            <InputField
              label="Nome Fantasia"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SelectField
              label="Tipo Doc."
              value={docType}
              onChange={(e) =>
                setDocType(e.target.value as 'CNPJ' | 'CPF' | 'OUTRO')
              }
            >
              <option value="CNPJ">CNPJ</option>
              <option value="CPF">CPF</option>
              <option value="OUTRO">Outro</option>
            </SelectField>

            <div className="sm:col-span-2">
              <InputField
                label="Número do Documento"
                value={docNumber}
                onChange={(e) => {
                  const val = e.target.value;
                  setDocNumber(
                    docType === 'CNPJ'
                      ? formatCNPJ(val)
                      : docType === 'CPF'
                        ? formatCPF(val)
                        : val
                  );
                }}
                error={clientErrors.document_number}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InputField
              label="Responsável / Contato"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <InputField
              label="Telefone / WhatsApp"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
            />
            <InputField
              label="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={clientErrors.email}
            />
          </div>

          <TextareaField
            label="Observações Contratuais / Operacionais"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </form>
      </Modal>

      {/* Modal Nova Unidade / Endereço */}
      <Modal
        isOpen={Boolean(unitModalClient)}
        onClose={() => setUnitModalClient(null)}
        title={`Nova Unidade — ${unitModalClient?.trade_name || unitModalClient?.name || ''}`}
        subtitle="Endereço físico de instalação das balanças e atendimento técnico"
        footer={
          <>
            <Button variant="outline" onClick={() => setUnitModalClient(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="unit-form" isLoading={savingUnit}>
              Salvar Unidade
            </Button>
          </>
        }
      >
        <form id="unit-form" onSubmit={handleSaveUnit} className="space-y-4">
          {unitSubmitErr && (
            <AlertBanner variant="error" message={unitSubmitErr} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <InputField
                label="Identificação da Unidade"
                required
                placeholder="Ex.: Matriz Industrial, Filial CD Campinas"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                error={unitErrors.unit_name}
              />
            </div>
            <InputField
              label="CEP"
              placeholder="00000-000"
              value={postalCode}
              onChange={(e) => setPostalCode(formatCEP(e.target.value))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-3">
              <InputField
                label="Logradouro / Rua / Rodovia"
                required
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                error={unitErrors.street}
              />
            </div>
            <InputField
              label="Número / KM"
              value={streetNumber}
              onChange={(e) => setStreetNumber(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InputField
              label="Bairro / Distrito"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
            />
            <InputField
              label="Cidade"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              error={unitErrors.city}
            />
            <SelectField
              label="UF"
              required
              value={stateUf}
              onChange={(e) => setStateUf(e.target.value)}
              error={unitErrors.state}
            >
              {BRAZILIAN_STATES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Contato no Local"
              value={unitContact}
              onChange={(e) => setUnitContact(e.target.value)}
            />
            <InputField
              label="Telefone da Unidade"
              value={unitPhone}
              onChange={(e) => setUnitPhone(formatPhone(e.target.value))}
            />
          </div>

          <CheckboxField
            label="Definir como unidade principal do cliente"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
          />
        </form>
      </Modal>
    </div>
  );
};
