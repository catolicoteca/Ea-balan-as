import React, { useCallback, useEffect, useState } from 'react';
import {
  Wrench,
  Plus,
  Edit3,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Share2,
  Copy,
  RefreshCw,
  AlertTriangle,
  Check,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import {
  formatCPF,
  formatPhone,
  technicianSchema,
  zodErrorsToMap,
} from '../lib/validation';
import type { Technician, CompanyInvitation } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import {
  CheckboxField,
  InputField,
  TextareaField,
} from '../components/ui/FormField';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';

const PRESET_TECH_COLORS = [
  '#0D9488',
  '#0284C7',
  '#4F46E5',
  '#D97706',
  '#059669',
  '#DC2626',
  '#7C3AED',
];

export const TechniciansPage: React.FC = () => {
  const { activeCompany, user, permissions } = useAuthTenant();

  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [invitations, setInvitations] = useState<CompanyInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTech, setEditingTech] = useState<Technician | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [regCode, setRegCode] = useState('');
  const [specialtiesText, setSpecialtiesText] = useState('');
  const [calendarColor, setCalendarColor] = useState('#0D9488');
  const [canViewAllOS, setCanViewAllOS] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Auto-clear toast
  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  const loadTechnicians = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);

    const [techRes, invRes] = await Promise.all([
      supabase
        .from('technicians')
        .select('*')
        .eq('company_id', activeCompany.id)
        .order('full_name', { ascending: true }),
      supabase
        .from('company_invitations')
        .select('*')
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: false }),
    ]);

    if (techRes.error) {
      setError(translateSupabaseError(techRes.error));
      setTechnicians([]);
    } else {
      setTechnicians((techRes.data as Technician[]) ?? []);
    }

    if (!invRes.error && invRes.data) {
      setInvitations(invRes.data as CompanyInvitation[]);
    }

    setLoading(false);
  }, [activeCompany]);

  useEffect(() => {
    void loadTechnicians();
  }, [loadTechnicians]);

  const findInvitationForTech = (t: Technician): CompanyInvitation | undefined => {
    return invitations.find(
      (inv) =>
        (inv.technician_id && inv.technician_id === t.id) ||
        (t.email && inv.email.toLowerCase() === t.email.toLowerCase())
    );
  };

  const getInvitationStatus = (inv?: CompanyInvitation) => {
    if (!inv) return { status: 'none', label: 'Sem Convite', color: 'slate' };
    if (inv.status === 'accepted') return { status: 'accepted', label: 'Aceito', color: 'emerald' };
    if (inv.status === 'revoked') return { status: 'revoked', label: 'Revogado', color: 'red' };

    const createdAtTime = new Date(inv.created_at).getTime();
    const isExpired = createdAtTime + 7 * 24 * 60 * 60 * 1000 < Date.now();
    if (isExpired) {
      return { status: 'expired', label: 'Expirado', color: 'red' };
    }
    return { status: 'pending', label: 'Pendente', color: 'amber' };
  };

  const getActivationLink = (invitationId: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/ativar?convite=${invitationId}`;
  };

  const handleCopyLink = async (invitationId: string) => {
    const link = getActivationLink(invitationId);
    try {
      await navigator.clipboard.writeText(link);
      setToastMsg('Link de ativação copiado para a área de transferência!');
    } catch {
      setToastMsg(`Link gerado: ${link}`);
    }
  };

  const handleSendWhatsApp = (t: Technician, invId: string) => {
    const link = getActivationLink(invId);
    const company = activeCompany?.name || 'EA Balanças';
    const cleanPhone = t.phone?.replace(/\D/g, '') || '';

    let msg = `Olá, *${t.full_name}*!\n\n`;
    msg += `Você foi cadastrado como Técnico na equipe da *${company}*.\n`;
    msg += `Para ativar seu acesso ao aplicativo em campo e receber suas Ordens de Serviço, clique no link seguro abaixo e defina sua senha pessoal:\n\n`;
    msg += `${link}\n\n`;
    msg += `_Este convite é pessoal, intransferível e possui validade de 7 dias._`;

    const url = cleanPhone
      ? `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const handleResendInvitation = async (inv: CompanyInvitation, t: Technician) => {
    setLoadingActionId(inv.id);
    try {
      const { error: rpcErr } = await supabase.rpc('resend_company_invitation', {
        p_invitation_id: inv.id,
      });

      if (rpcErr) {
        await supabase
          .from('company_invitations')
          .update({ created_at: new Date().toISOString(), status: 'pending' })
          .eq('id', inv.id);
      }

      setToastMsg(`Convite renovado com sucesso para ${t.full_name}! Validade renovada por mais 7 dias.`);
      await loadTechnicians();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao reenviar convite.';
      setError(msg);
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleCreateInvitation = async (t: Technician) => {
    if (!t.email || !activeCompany) return;
    setLoadingActionId(t.id);
    try {
      const { error: insErr } = await supabase.from('company_invitations').insert({
        company_id: activeCompany.id,
        email: t.email.toLowerCase(),
        full_name: t.full_name,
        role: 'technician',
        technician_id: t.id,
        invited_by: user?.id ?? null,
      });

      if (insErr) throw insErr;
      setToastMsg(`Convite gerado para ${t.full_name}! Você já pode enviar pelo WhatsApp.`);
      await loadTechnicians();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar convite.';
      setError(msg);
    } finally {
      setLoadingActionId(null);
    }
  };

  const openNew = () => {
    setEditingTech(null);
    setFullName('');
    setEmail('');
    setPhone('');
    setCpf('');
    setRegCode('');
    setSpecialtiesText('Balanças Comerciais, Plataforma');
    setCalendarColor(
      PRESET_TECH_COLORS[technicians.length % PRESET_TECH_COLORS.length]
    );
    setCanViewAllOS(false);
    setIsActive(true);
    setNotes('');
    setFieldErrors({});
    setSubmitErr(null);
    setModalOpen(true);
  };

  const openEdit = (t: Technician) => {
    setEditingTech(t);
    setFullName(t.full_name);
    setEmail(t.email ?? '');
    setPhone(t.phone ?? '');
    setCpf(t.document_cpf ?? '');
    setRegCode(t.registration_code ?? '');
    setSpecialtiesText((t.specialties ?? []).join(', '));
    setCalendarColor(t.calendar_color || '#0D9488');
    setCanViewAllOS(t.can_view_all_company_os);
    setIsActive(t.is_active);
    setNotes(t.notes ?? '');
    setFieldErrors({});
    setSubmitErr(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;

    setFieldErrors({});
    setSubmitErr(null);

    const parsed = technicianSchema.safeParse({
      full_name: fullName,
      email: email || undefined,
      phone: phone || undefined,
      document_cpf: cpf || undefined,
      registration_code: regCode || undefined,
      specialtiesText: specialtiesText || undefined,
      calendar_color: calendarColor,
      can_view_all_company_os: canViewAllOS,
      is_active: isActive,
      notes: notes || undefined,
    });

    if (!parsed.success) {
      setFieldErrors(zodErrorsToMap(parsed.error));
      return;
    }

    const specialties = (parsed.data.specialtiesText ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    setSaving(true);
    const payload = {
      company_id: activeCompany.id,
      full_name: parsed.data.full_name,
      email: parsed.data.email ? parsed.data.email.toLowerCase() : null,
      phone: parsed.data.phone || null,
      document_cpf: parsed.data.document_cpf || null,
      registration_code: parsed.data.registration_code || null,
      specialties,
      calendar_color: parsed.data.calendar_color,
      can_view_all_company_os: parsed.data.can_view_all_company_os,
      is_active: parsed.data.is_active,
      notes: parsed.data.notes || null,
    };

    if (editingTech) {
      const { error: uErr } = await supabase
        .from('technicians')
        .update(payload)
        .eq('id', editingTech.id)
        .eq('company_id', activeCompany.id);

      setSaving(false);
      if (uErr) {
        setSubmitErr(translateSupabaseError(uErr));
        return;
      }
    } else {
      const { data: createdTech, error: iErr } = await supabase
        .from('technicians')
        .insert(payload)
        .select('id, email')
        .single();

      if (iErr) {
        setSaving(false);
        setSubmitErr(translateSupabaseError(iErr));
        return;
      }

      // Se informou e-mail, já registra convite automático para vincular conta Supabase Auth no login/cadastro
      if (createdTech?.email) {
        await supabase.from('company_invitations').insert({
          company_id: activeCompany.id,
          email: createdTech.email.toLowerCase(),
          full_name: parsed.data.full_name,
          role: 'technician',
          technician_id: createdTech.id,
          invited_by: user?.id ?? null,
        });
      }
      setSaving(false);
    }

    setModalOpen(false);
    await loadTechnicians();
  };

  const handleDeleteTechnician = async (tech: Technician) => {
    if (!activeCompany) return;
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir o técnico "${tech.full_name}"?\n\nConvites pendentes deste técnico também serão removidos. Se ele já possuir Ordens de Serviço no histórico, use a opção de inativá-lo em "Configurar Técnico".`
    );
    if (!confirmed) return;

    setLoadingActionId(tech.id);
    setError(null);

    try {
      // Remove convites pendentes associados a este técnico antes de excluir a ficha
      await supabase
        .from('company_invitations')
        .delete()
        .eq('company_id', activeCompany.id)
        .eq('technician_id', tech.id);

      const { error: dErr } = await supabase
        .from('technicians')
        .delete()
        .eq('id', tech.id)
        .eq('company_id', activeCompany.id);

      if (dErr) {
        if (dErr.code === '23503') {
          setError(
            `Não é possível excluir "${tech.full_name}" porque já existem Ordens de Serviço vinculadas a ele no histórico. Abra "Configurar Técnico" e desmarque "Técnico ativo" para inativá-lo com segurança.`
          );
        } else {
          setError(translateSupabaseError(dErr));
        }
      } else {
        setToastMsg(`Técnico "${tech.full_name}" excluído com sucesso.`);
        setTimeout(() => setToastMsg(null), 3500);
        await loadTechnicians();
      }
    } finally {
      setLoadingActionId(null);
    }
  };

  if (!permissions.canManageTechnicians) {
    return (
      <AlertBanner
        variant="warning"
        title="Acesso Restrito ao Gestor"
        message="O módulo de gerenciamento de técnicos é exclusivo para Gestores da empresa e Administradores da plataforma."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border border-slate-700 animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Equipe Técnica de Campo
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Cadastro de técnicos, credenciais metrológicas, vínculo de acesso e regras de visibilidade de OS.
          </p>
        </div>

        <Button onClick={openNew} leftIcon={<Plus className="w-4 h-4" />}>
          Novo Técnico
        </Button>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Carregando equipe técnica...
          </div>
        ) : technicians.length === 0 ? (
          <EmptyState
            icon={<Wrench className="w-5 h-5" />}
            title="Nenhum técnico cadastrado nesta empresa"
            description="Cadastre os técnicos de campo para atribuí-los às ordens de serviço e organizar a agenda."
            action={
              <Button
                size="sm"
                onClick={openNew}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Cadastrar Primeiro Técnico
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {technicians.map((t) => (
              <div
                key={t.id}
                className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
                        style={{ backgroundColor: t.calendar_color || '#0D9488' }}
                      >
                        {t.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 truncate">
                          {t.full_name}
                        </h3>
                        <div className="text-xs text-slate-500 truncate">
                          {t.email || 'E-mail não informado'}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                        t.is_active
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {t.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    {t.phone && <div>Tel.: {t.phone}</div>}
                    {t.registration_code && (
                      <div className="font-mono text-[11px] text-slate-500">
                        Registro CFT/IPEM: {t.registration_code}
                      </div>
                    )}
                  </div>

                  {t.specialties && t.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {t.specialties.map((sp) => (
                        <span
                          key={sp}
                          className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]"
                        >
                          {sp}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Status e Gestão do Convite de Acesso */}
                  <div className="pt-2 border-t border-slate-100 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        {t.user_id ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-800 font-medium">
                              Conta de acesso vinculada
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-slate-500 font-medium">Acesso:</span>
                            {(() => {
                              const inv = findInvitationForTech(t);
                              const st = getInvitationStatus(inv);
                              if (st.status === 'accepted') {
                                return (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                                    Convite Aceito
                                  </span>
                                );
                              }
                              if (st.status === 'expired') {
                                return (
                                  <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-semibold border border-red-200 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3 text-red-600" />
                                    Convite Expirado
                                  </span>
                                );
                              }
                              if (st.status === 'pending') {
                                return (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 font-semibold border border-amber-200 flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-amber-600" />
                                    Convite Pendente
                                  </span>
                                );
                              }
                              return (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium border border-slate-200">
                                  Sem Convite
                                </span>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-slate-600">
                      <ShieldCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                      <span>
                        {t.can_view_all_company_os
                          ? 'Autorização explícita: vê todas as OS da empresa'
                          : 'Padrão RLS: vê apenas OS atribuídas a ele'}
                      </span>
                    </div>

                    {/* Botões de Ação para Convite WhatsApp e Link */}
                    {!t.user_id && (
                      <div className="pt-2 flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200">
                        {(() => {
                          const inv = findInvitationForTech(t);
                          if (!inv) {
                            return t.email ? (
                              <button
                                onClick={() => handleCreateInvitation(t)}
                                disabled={loadingActionId === t.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 text-[11px] font-medium border border-teal-200 transition-colors"
                              >
                                <Plus className="w-3 h-3 text-teal-600" />
                                <span>Gerar Convite de Acesso</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">
                                Cadastre um e-mail para emitir o convite
                              </span>
                            );
                          }

                          const st = getInvitationStatus(inv);
                          return (
                            <>
                              {/* Botão Enviar por WhatsApp */}
                              <button
                                onClick={() => handleSendWhatsApp(t, inv.id)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold shadow-xs transition-colors"
                                title="Enviar convite de ativação com link seguro via WhatsApp"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                <span>Enviar convite por WhatsApp</span>
                              </button>

                              {/* Botão Copiar Link */}
                              <button
                                onClick={() => handleCopyLink(inv.id)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium border border-slate-300 transition-colors"
                                title="Copiar link de ativação para a área de transferência"
                              >
                                <Copy className="w-3.5 h-3.5 text-slate-500" />
                                <span>Copiar link de convite</span>
                              </button>

                              {/* Botão Reenviar (se pendente ou expirado) */}
                              {(st.status === 'expired' || st.status === 'pending') && (
                                <button
                                  onClick={() => handleResendInvitation(inv, t)}
                                  disabled={loadingActionId === inv.id}
                                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 text-[11px] font-medium transition-colors"
                                  title="Renovar validade do convite por mais 7 dias"
                                >
                                  <RefreshCw className={`w-3 h-3 ${loadingActionId === inv.id ? 'animate-spin' : ''}`} />
                                  <span>Reenviar</span>
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    isLoading={loadingActionId === t.id}
                    onClick={() => handleDeleteTechnician(t)}
                    leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    Excluir
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(t)}
                    leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                  >
                    Configurar Técnico
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTech ? 'Editar Técnico' : 'Novo Técnico de Campo'}
        subtitle="Credenciais, cor na agenda e política de acesso no banco (RLS)"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="tech-form" isLoading={saving}>
              Salvar Técnico
            </Button>
          </>
        }
      >
        <form id="tech-form" onSubmit={handleSave} className="space-y-4">
          {submitErr && <AlertBanner variant="error" message={submitErr} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Nome Completo"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              error={fieldErrors.full_name}
            />
            <InputField
              label="E-mail de Acesso (Supabase Auth)"
              type="email"
              placeholder="tecnico@eabalancas.com.br"
              hint="Ao cadastrar conta com este e-mail, o técnico entra automaticamente com perfil restrito."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldErrors.email}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InputField
              label="Telefone / Celular"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
            />
            <InputField
              label="CPF"
              value={cpf}
              onChange={(e) => setCpf(formatCPF(e.target.value))}
              error={fieldErrors.document_cpf}
            />
            <InputField
              label="Registro CFT / CREA / IPEM"
              placeholder="Ex.: CFT-SP 104922"
              value={regCode}
              onChange={(e) => setRegCode(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <InputField
                label="Especialidades (separadas por vírgula)"
                placeholder="Ex.: Rodoviária, Plataforma, Analítica, Calibração RBC"
                value={specialtiesText}
                onChange={(e) => setSpecialtiesText(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700">
                Cor na Agenda
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={calendarColor}
                  onChange={(e) => setCalendarColor(e.target.value)}
                  className="h-9 w-12 rounded border border-slate-300 cursor-pointer"
                />
                <span className="font-mono text-xs text-slate-600">
                  {calendarColor}
                </span>
              </div>
            </div>
          </div>

          <TextareaField
            label="Observações"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <CheckboxField
            label="Autorização explícita para visualizar OS de outros técnicos desta empresa"
            description="Desmarcado por padrão (regra de segurança): o banco PostgreSQL restringe este técnico estritamente às OS atribuídas a ele."
            checked={canViewAllOS}
            onChange={(e) => setCanViewAllOS(e.target.checked)}
          />

          <CheckboxField
            label="Técnico ativo para novos agendamentos"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        </form>
      </Modal>
    </div>
  );
};
