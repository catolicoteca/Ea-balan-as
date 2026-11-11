import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  Shield,
  ArrowUpRight,
  Lock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import {
  formatCNPJ,
  newTenantSchema,
  slugifyCompanyName,
  zodErrorsToMap,
} from '../lib/validation';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { InputField } from '../components/ui/FormField';
import { AlertBanner } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';

export const PlatformCompaniesPage: React.FC = () => {
  const {
    companies,
    memberships,
    activeCompany,
    user,
    refreshTenantContext,
    selectCompany,
  } = useAuthTenant();
  const navigate = useNavigate();

  const [newTenantModal, setNewTenantModal] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [tenantLegalName, setTenantLegalName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenantCnpj, setTenantCnpj] = useState('');
  const [tenantSidebar, setTenantSidebar] = useState('#0B2545');
  const [tenantPrimary, setTenantPrimary] = useState('#0D9488');
  const [tenantAccent, setTenantAccent] = useState('#14B8A6');
  const [tenantManagerEmail, setTenantManagerEmail] = useState('');
  const [tenantErrors, setTenantErrors] = useState<Record<string, string>>({});
  const [tenantSubmitErr, setTenantSubmitErr] = useState<string | null>(null);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [actionMsg, setActionMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const isLinkedManager = (companyId: string) =>
    memberships.some(
      (m) => m.company_id === companyId && m.is_active && m.role === 'manager'
    );

  const handleCreateNewTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setTenantErrors({});
    setTenantSubmitErr(null);

    const parsed = newTenantSchema.safeParse({
      name: tenantName,
      legal_name: tenantLegalName || undefined,
      slug: tenantSlug || slugifyCompanyName(tenantName),
      document_cnpj: tenantCnpj || undefined,
      sidebar_color: tenantSidebar,
      primary_color: tenantPrimary,
      accent_color: tenantAccent,
    });

    if (!parsed.success) {
      setTenantErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setCreatingTenant(true);
    const { data: created, error } = await supabase
      .from('companies')
      .insert({
        name: parsed.data.name,
        legal_name: parsed.data.legal_name || null,
        slug: parsed.data.slug,
        document_cnpj: parsed.data.document_cnpj || null,
        sidebar_color: parsed.data.sidebar_color,
        primary_color: parsed.data.primary_color,
        accent_color: parsed.data.accent_color,
        created_by: user?.id ?? null,
      })
      .select('id')
      .single();

    if (error) {
      setCreatingTenant(false);
      setTenantSubmitErr(translateSupabaseError(error));
      return;
    }

    if (created?.id && tenantManagerEmail.trim()) {
      await supabase.from('company_invitations').insert({
        company_id: created.id,
        email: tenantManagerEmail.trim().toLowerCase(),
        role: 'manager',
        invited_by: user?.id ?? null,
      });
    }

    setCreatingTenant(false);
    setNewTenantModal(false);
    setTenantName('');
    setTenantLegalName('');
    setTenantSlug('');
    setTenantCnpj('');
    setTenantManagerEmail('');
    setActionMsg({
      type: 'success',
      text: `Empresa "${parsed.data.name}" criada com sucesso no Metrion!`,
    });
    await refreshTenantContext();
  };

  const handleToggleCompanyActive = async (companyId: string, nextActive: boolean) => {
    setActionMsg(null);
    const { error } = await supabase
      .from('companies')
      .update({ is_active: nextActive })
      .eq('id', companyId);

    if (error) {
      setActionMsg({ type: 'error', text: translateSupabaseError(error) });
      return;
    }

    setActionMsg({
      type: 'success',
      text: nextActive
        ? 'Empresa reativada com sucesso.'
        : 'Empresa suspensa. O acesso operacional dos usuários desta empresa foi bloqueado.',
    });
    await refreshTenantContext();
  };

  const handleOpenManagedCompany = (companyId: string) => {
    selectCompany(companyId);
    navigate('/app/dashboard');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-teal-700" />
            Empresas Assinantes (Tenants)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Cadastre, ative ou suspenda empresas isoladas na plataforma Metrion.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setNewTenantModal(true)}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Cadastrar Nova Empresa
        </Button>
      </div>

      {actionMsg && (
        <AlertBanner
          variant={actionMsg.type === 'success' ? 'success' : 'error'}
          message={actionMsg.text}
        />
      )}

      <Card
        title={`Empresas Cadastradas (${companies.length})`}
        subtitle="Cada empresa opera em ambiente isolado com RLS próprio no PostgreSQL"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {companies.map((c) => {
            const isCurrent = c.id === activeCompany?.id;
            const hasManagerLink = isLinkedManager(c.id);

            return (
              <div
                key={c.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-4 ${
                  isCurrent
                    ? 'border-teal-500 bg-teal-50/20'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: c.sidebar_color }}
                    >
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                        {c.name}
                        {hasManagerLink && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 font-semibold">
                            Vínculo de Gestor
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        slug: {c.slug}{' '}
                        {c.document_cnpj ? `• ${c.document_cnpj}` : ''}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${
                      c.is_active
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {c.is_active ? 'Ativa' : 'Suspensa'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Shield className="w-3.5 h-3.5 text-teal-600" />
                    Isolamento RLS ativo
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {hasManagerLink ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenManagedCompany(c.id)}
                        leftIcon={<ArrowUpRight className="w-3.5 h-3.5" />}
                      >
                        Painel Gestor (/app)
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 px-2 py-1 rounded bg-slate-50 border border-slate-200">
                        <Lock className="w-3 h-3" />
                        Suporte auditado (Fase B)
                      </span>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      className={
                        c.is_active
                          ? 'text-red-600 hover:bg-red-50'
                          : 'text-emerald-700 hover:bg-emerald-50'
                      }
                      onClick={() =>
                        void handleToggleCompanyActive(c.id, !c.is_active)
                      }
                    >
                      {c.is_active ? 'Suspender' : 'Reativar'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Modal Nova Empresa Multi-tenant */}
      <Modal
        isOpen={newTenantModal}
        onClose={() => setNewTenantModal(false)}
        title="Nova Empresa Assinante (Metrion)"
        subtitle="Cria um ambiente empresarial isolado por company_id e RLS"
        footer={
          <>
            <Button variant="outline" onClick={() => setNewTenantModal(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="new-tenant-form"
              isLoading={creatingTenant}
            >
              Criar Empresa
            </Button>
          </>
        }
      >
        <form
          id="new-tenant-form"
          onSubmit={handleCreateNewTenant}
          className="space-y-4"
        >
          {tenantSubmitErr && (
            <AlertBanner variant="error" message={tenantSubmitErr} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Nome Fantasia"
              required
              value={tenantName}
              onChange={(e) => {
                setTenantName(e.target.value);
                setTenantSlug(slugifyCompanyName(e.target.value));
              }}
              error={tenantErrors.name}
            />
            <InputField
              label="Identificador (Slug)"
              required
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              error={tenantErrors.slug}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Razão Social"
              value={tenantLegalName}
              onChange={(e) => setTenantLegalName(e.target.value)}
            />
            <InputField
              label="CNPJ"
              value={tenantCnpj}
              onChange={(e) => setTenantCnpj(formatCNPJ(e.target.value))}
              error={tenantErrors.document_cnpj}
            />
          </div>

          <InputField
            label="E-mail do Gestor Inicial (opcional)"
            type="email"
            placeholder="gestor@novaempresa.com.br"
            hint="Cria convite automático de Gestor para esta empresa."
            value={tenantManagerEmail}
            onChange={(e) => setTenantManagerEmail(e.target.value)}
          />

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cor Sidebar
              </label>
              <input
                type="color"
                value={tenantSidebar}
                onChange={(e) => setTenantSidebar(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cor Primária
              </label>
              <input
                type="color"
                value={tenantPrimary}
                onChange={(e) => setTenantPrimary(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cor Realce
              </label>
              <input
                type="color"
                value={tenantAccent}
                onChange={(e) => setTenantAccent(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 cursor-pointer"
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
