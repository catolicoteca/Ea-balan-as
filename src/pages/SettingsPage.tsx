import React, { useCallback, useEffect, useState } from 'react';
import {
  Palette,
  Users,
  Upload,
  RotateCcw,
  Plus,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_BRAND_COLORS,
  useAuthTenant,
} from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import {
  companySettingsSchema,
  formatCNPJ,
  formatPhone,
  zodErrorsToMap,
} from '../lib/validation';
import type {
  AppRole,
  CompanyInvitation,
  CompanyMembership,
} from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { BrandLogo } from '../components/ui/BrandLogo';
import { InputField, SelectField } from '../components/ui/FormField';
import { AlertBanner } from '../components/ui/EmptyState';

type SettingsTab = 'branding' | 'team';

export const SettingsPage: React.FC = () => {
  const {
    activeCompany,
    user,
    permissions,
    refreshTenantContext,
  } = useAuthTenant();

  const [tab, setTab] = useState<SettingsTab>('branding');

  // Aba 1: Identidade Visual & Dados da Empresa
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [sidebarColor, setSidebarColor] = useState(DEFAULT_BRAND_COLORS.sidebar_color);
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_BRAND_COLORS.primary_color);
  const [accentColor, setAccentColor] = useState(DEFAULT_BRAND_COLORS.accent_color);

  const [brandErrors, setBrandErrors] = useState<Record<string, string>>({});
  const [brandMsg, setBrandMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [savingBrand, setSavingBrand] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Aba 2: Equipe & Convites
  const [teamMembers, setTeamMembers] = useState<CompanyMembership[]>([]);
  const [invitations, setInvitations] = useState<CompanyInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('technician');
  const [savingInvite, setSavingInvite] = useState(false);
  const [teamMsg, setTeamMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!activeCompany) return;
    setName(activeCompany.name);
    setLegalName(activeCompany.legal_name ?? '');
    setCnpj(activeCompany.document_cnpj ?? '');
    setEmail(activeCompany.email ?? '');
    setPhone(activeCompany.phone ?? '');
    setLogoUrl(activeCompany.logo_url ?? '');
    setSidebarColor(activeCompany.sidebar_color || DEFAULT_BRAND_COLORS.sidebar_color);
    setPrimaryColor(activeCompany.primary_color || DEFAULT_BRAND_COLORS.primary_color);
    setAccentColor(activeCompany.accent_color || DEFAULT_BRAND_COLORS.accent_color);
    setBrandMsg(null);
    setBrandErrors({});
  }, [activeCompany]);

  const loadTeamData = useCallback(async () => {
    if (!activeCompany || !permissions.canManageCompanySettings) return;

    const [memRes, invRes] = await Promise.all([
      supabase
        .from('company_memberships')
        .select('*, profile:profiles(id, full_name, email)')
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('company_invitations')
        .select('*')
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: false }),
    ]);

    setTeamMembers((memRes.data as unknown as CompanyMembership[]) ?? []);
    setInvitations((invRes.data as CompanyInvitation[]) ?? []);
  }, [activeCompany, permissions.canManageCompanySettings]);

  useEffect(() => {
    if (tab === 'team') {
      void loadTeamData();
    }
  }, [tab, loadTeamData]);

  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCompany) return;

    setBrandMsg(null);
    if (file.size > 5 * 1024 * 1024) {
      setBrandMsg({
        type: 'error',
        text: 'O arquivo de logotipo deve ter no máximo 5 MB.',
      });
      return;
    }

    setUploadingLogo(true);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${activeCompany.id}/logo-${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('company-assets')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadErr) {
      setUploadingLogo(false);
      setBrandMsg({
        type: 'error',
        text: translateSupabaseError(uploadErr),
      });
      return;
    }

    const { data: pubUrl } = supabase.storage
      .from('company-assets')
      .getPublicUrl(path);

    setLogoUrl(pubUrl.publicUrl);
    setUploadingLogo(false);
    setBrandMsg({
      type: 'success',
      text: 'Logotipo enviado ao Supabase Storage! Clique em "Salvar Configurações" para confirmar.',
    });
  };

  const handleSaveCompanySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;

    setBrandErrors({});
    setBrandMsg(null);

    const parsed = companySettingsSchema.safeParse({
      name,
      legal_name: legalName || undefined,
      document_cnpj: cnpj || undefined,
      email: email || undefined,
      phone: phone || undefined,
      logo_url: logoUrl || undefined,
      sidebar_color: sidebarColor,
      primary_color: primaryColor,
      accent_color: accentColor,
    });

    if (!parsed.success) {
      setBrandErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setSavingBrand(true);
    const { error } = await supabase
      .from('companies')
      .update({
        name: parsed.data.name,
        legal_name: parsed.data.legal_name || null,
        document_cnpj: parsed.data.document_cnpj || null,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        logo_url: parsed.data.logo_url || null,
        sidebar_color: parsed.data.sidebar_color,
        primary_color: parsed.data.primary_color,
        accent_color: parsed.data.accent_color,
      })
      .eq('id', activeCompany.id);

    setSavingBrand(false);

    if (error) {
      setBrandMsg({ type: 'error', text: translateSupabaseError(error) });
      return;
    }

    await refreshTenantContext();
    setBrandMsg({
      type: 'success',
      text: 'Identidade visual e dados da empresa salvos no banco de dados!',
    });
  };

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;
    setTeamMsg(null);

    if (!inviteEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
      setTeamMsg({ type: 'error', text: 'Informe um endereço de e-mail válido.' });
      return;
    }

    setSavingInvite(true);
    const cleanEmail = inviteEmail.trim().toLowerCase();

    let linkedTechId: string | null = null;
    if (inviteRole === 'technician') {
      const { data: createdTech } = await supabase
        .from('technicians')
        .insert({
          company_id: activeCompany.id,
          full_name: inviteName.trim() || cleanEmail.split('@')[0],
          email: cleanEmail,
        })
        .select('id')
        .maybeSingle();
      linkedTechId = createdTech?.id ?? null;
    }

    const { error } = await supabase.from('company_invitations').insert({
      company_id: activeCompany.id,
      email: cleanEmail,
      full_name: inviteName.trim() || null,
      role: inviteRole,
      technician_id: linkedTechId,
      invited_by: user?.id ?? null,
    });

    setSavingInvite(false);

    if (error) {
      setTeamMsg({ type: 'error', text: translateSupabaseError(error) });
      return;
    }

    setInviteEmail('');
    setInviteName('');
    setTeamMsg({
      type: 'success',
      text: `Convite registrado para ${cleanEmail}. Assim que este usuário se cadastrar ou entrar no Supabase Auth, será vinculado automaticamente como ${
        inviteRole === 'manager' ? 'Gestor' : 'Técnico'
      }.`,
    });
    await loadTeamData();
  };

  if (!permissions.canManageCompanySettings) {
    return (
      <AlertBanner
        variant="warning"
        title="Acesso Restrito"
        message="As configurações da empresa e permissões são exclusivas para Gestores e Administradores."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Configurações & Personalização
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Identidade visual white-label e gestão da equipe desta empresa.
        </p>
      </div>

      {/* Navegação em Abas */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setTab('branding')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
            tab === 'branding'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Palette className="w-4 h-4" />
          Identidade Visual & Empresa
        </button>

        <button
          type="button"
          onClick={() => setTab('team')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
            tab === 'team'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Users className="w-4 h-4" />
          Usuários & Permissões
        </button>
      </div>

      {/* ABA 1: IDENTIDADE VISUAL E DADOS DA EMPRESA */}
      {tab === 'branding' && (
        <form onSubmit={handleSaveCompanySettings} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            <Card
              title="Dados Corporativos e Logotipo"
              subtitle="Personalize o nome e a marca exibidos para todos os usuários desta empresa"
            >
              <div className="space-y-4">
                {brandMsg && (
                  <AlertBanner
                    variant={brandMsg.type === 'success' ? 'success' : 'error'}
                    message={brandMsg.text}
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InputField
                    label="Nome Fantasia (Exibido no Menu)"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    error={brandErrors.name}
                  />
                  <InputField
                    label="Razão Social"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <InputField
                    label="CNPJ"
                    placeholder="00.000.000/0001-00"
                    value={cnpj}
                    onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
                    error={brandErrors.document_cnpj}
                  />
                  <InputField
                    label="Telefone Comercial"
                    type="tel"
                    inputMode="tel"
                    maxLength={20}
                    placeholder="(11) 99999-9999"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    error={brandErrors.phone}
                  />
                  <InputField
                    label="E-mail de Atendimento"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={brandErrors.email}
                  />
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <label className="block text-xs font-medium text-slate-700">
                    Logotipo da Empresa (Supabase Storage ou URL)
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer">
                      <Upload className="w-4 h-4 text-teal-600" />
                      {uploadingLogo
                        ? 'Enviando ao Storage...'
                        : 'Enviar Imagem (PNG/JPG/SVG)'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleLogoFileUpload}
                        className="hidden"
                        disabled={uploadingLogo}
                      />
                    </label>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl('')}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remover logotipo personalizado
                      </button>
                    )}
                  </div>

                  <InputField
                    label="URL Pública do Logotipo (opcional)"
                    placeholder="https://..."
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    error={brandErrors.logo_url}
                  />
                </div>
              </div>
            </Card>

            <Card
              title="Paleta de Cores da Empresa"
              subtitle="Padrão EA Balanças: Sidebar Azul-Marinho (#0B2545) e Detalhes Verde-Petróleo (#0D9488)"
              actions={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSidebarColor(DEFAULT_BRAND_COLORS.sidebar_color);
                    setPrimaryColor(DEFAULT_BRAND_COLORS.primary_color);
                    setAccentColor(DEFAULT_BRAND_COLORS.accent_color);
                  }}
                  leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                >
                  Restaurar Padrão EA Balanças
                </Button>
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Cor da Sidebar
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={sidebarColor}
                      onChange={(e) => setSidebarColor(e.target.value)}
                      className="h-10 w-12 rounded border border-slate-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={sidebarColor}
                      onChange={(e) => setSidebarColor(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  {brandErrors.sidebar_color && (
                    <p className="text-xs text-red-600">{brandErrors.sidebar_color}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Cor Primária (Botões & Destaques)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-10 w-12 rounded border border-slate-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  {brandErrors.primary_color && (
                    <p className="text-xs text-red-600">{brandErrors.primary_color}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Cor Secundária / Realce
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-10 w-12 rounded border border-slate-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  {brandErrors.accent_color && (
                    <p className="text-xs text-red-600">{brandErrors.accent_color}</p>
                  )}
                </div>
              </div>

              <div className="pt-5 flex justify-end">
                <Button
                  type="submit"
                  size="lg"
                  isLoading={savingBrand}
                  leftIcon={<CheckCircle2 className="w-4 h-4" />}
                >
                  Salvar Configurações no Banco
                </Button>
              </div>
            </Card>
          </div>

          {/* Pré-visualização ao Vivo */}
          <div className="lg:col-span-4">
            <Card
              title="Pré-visualização da Identidade"
              subtitle="Simulação instantânea do tema desta empresa"
            >
              <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                <div
                  className="p-4 text-white space-y-3"
                  style={{ backgroundColor: sidebarColor }}
                >
                  <BrandLogo
                    name={name || 'EA Balanças'}
                    logoUrl={logoUrl || null}
                    primaryColor={primaryColor}
                    size="sm"
                    variant="dark"
                  />
                  <div className="space-y-1 pt-2 text-xs">
                    <div className="px-3 py-2 rounded-lg bg-white/15 font-medium flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: accentColor }}
                      />
                      Dashboard Ativo
                    </div>
                    <div className="px-3 py-1.5 text-white/70">
                      Ordens de Serviço
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-[#F4F7FA] space-y-3">
                  <div className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-slate-500">Indicador</div>
                      <div className="text-sm font-bold text-slate-900">
                        Cartão Claro Corporativo
                      </div>
                    </div>
                    <span
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                      style={{ backgroundColor: primaryColor }}
                    >
                      Ação Primária
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </form>
      )}

      {/* ABA 2: USUÁRIOS, CONVITES E PERMISSÕES */}
      {tab === 'team' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <Card
              title="Autorizar Novo Usuário na Empresa"
              subtitle="Pré-autorize Gestores ou Técnicos por e-mail sem expor chaves administrativas"
            >
              <form onSubmit={handleSendInvitation} className="space-y-4">
                {teamMsg && (
                  <AlertBanner
                    variant={teamMsg.type === 'success' ? 'success' : 'error'}
                    message={teamMsg.text}
                  />
                )}

                <InputField
                  label="Nome do Colaborador"
                  placeholder="Ex.: Roberto Silva"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />

                <InputField
                  label="E-mail de Login"
                  type="email"
                  required
                  placeholder="colaborador@empresa.com.br"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />

                <SelectField
                  label="Perfil de Acesso na Empresa"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as AppRole)}
                >
                  <option value="technician">
                    Técnico (acesso restrito às OS atribuídas a ele)
                  </option>
                  <option value="manager">
                    Gestor (administração completa da empresa)
                  </option>
                </SelectField>

                <Button
                  type="submit"
                  className="w-full"
                  isLoading={savingInvite}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  Registrar Autorização de Acesso
                </Button>
              </form>
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <Card
              title={`Usuários Vinculados (${teamMembers.length})`}
              subtitle="Vínculos ativos em public.company_memberships validados por RLS"
            >
              {teamMembers.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Nenhum vínculo encontrado.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {teamMembers.map((m) => (
                    <div
                      key={m.id}
                      className="py-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">
                          {m.profile?.full_name || 'Usuário'}
                        </div>
                        <div className="text-slate-500">{m.profile?.email}</div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 font-medium">
                        {m.role === 'manager' ? 'Gestor' : 'Técnico'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title={`Convites Registrados (${invitations.length})`}
              subtitle="Histórico de autorizações por e-mail"
            >
              {invitations.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Nenhum convite enviado ainda.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {invitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="py-2.5 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-slate-800">
                          {inv.email}
                        </span>{' '}
                        <span className="text-slate-500">
                          ({inv.role === 'manager' ? 'Gestor' : 'Técnico'})
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          inv.status === 'accepted'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {inv.status === 'accepted' ? 'Aceito' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
