import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  Loader2,
  Wrench,
  Building,
  LogIn,
  LogOut,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { BrandLogo } from '../components/ui/BrandLogo';
import { Button } from '../components/ui/Button';
import { InputField } from '../components/ui/FormField';

interface InvitationValidationResult {
  valid: boolean;
  invitation_id?: string;
  email?: string;
  full_name?: string;
  company_name?: string;
  role?: string;
  already_accepted?: boolean;
  expired?: boolean;
  reason?: string;
}

export const ActivateAccountPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: loggedInUser, refreshTenantContext } = useAuthTenant();

  const invitationToken = searchParams.get('convite') || searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [invitationInfo, setInvitationInfo] = useState<InvitationValidationResult | null>(null);

  // Modo: 'new_user' (criar senha) ou 'existing_user' (já tem conta)
  const [mode, setMode] = useState<'new_user' | 'existing_user'>('new_user');

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 1. Valida o convite no servidor ao carregar a página
  useEffect(() => {
    let active = true;

    async function checkToken() {
      if (!invitationToken) {
        if (active) {
          setInvitationInfo({
            valid: false,
            reason: 'Nenhum código de convite informado na URL. Verifique o link enviado pelo gestor.',
          });
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('validate_invitation', {
          p_invitation_id: invitationToken,
        });

        if (!active) return;

        if (error) {
          setInvitationInfo({
            valid: false,
            reason: `Erro ao validar convite no servidor: ${error.message}`,
          });
        } else {
          const res = data as InvitationValidationResult;
          setInvitationInfo(res);
          if (res.full_name) {
            setFullName(res.full_name);
          }
        }
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Falha na validação do convite.';
        setInvitationInfo({ valid: false, reason: msg });
      } finally {
        if (active) setLoading(false);
      }
    }

    void checkToken();

    return () => {
      active = false;
    };
  }, [invitationToken]);

  // 2. Ação para usuário que JÁ está logado com a mesma conta
  const handleLinkCurrentAccount = async () => {
    if (!invitationToken) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('accept_company_invitation', {
        p_invitation_id: invitationToken,
      });
      if (error) {
        if (error.message.includes('ainda não foi confirmado') || error.message.toLowerCase().includes('confirm')) {
          setEmailConfirmationRequired(true);
          return;
        }
        throw error;
      }

      setSuccessMsg('Convite vinculado com sucesso à sua conta!');
      await refreshTenantContext();
      setTimeout(() => {
        navigate('/tecnico/ordens', { replace: true });
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao vincular convite.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 3. Ação para deslogar de outra conta e ativar com a conta do convite
  const handleSignOutOtherAccount = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  // 4. Submissão: Novo Usuário (Cadastro de Senha) ou Usuário Existente (Login e Vinculação)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setEmailConfirmationRequired(false);

    if (!invitationInfo || !invitationInfo.email) {
      setErrorMsg('Dados do convite inválidos.');
      return;
    }

    const email = invitationInfo.email.trim();

    if (mode === 'new_user') {
      if (password.length < 6) {
        setErrorMsg('A senha deve conter no mínimo 6 caracteres.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('A confirmação de senha não confere.');
        return;
      }
    } else {
      if (!password) {
        setErrorMsg('Informe sua senha atual.');
        return;
      }
    }

    setSubmitting(true);

    try {
      if (mode === 'new_user') {
        // 4.1 Cadastro de novo usuário via Supabase Auth
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo:
              typeof window !== 'undefined'
                ? invitationToken
                  ? `${window.location.origin}/ativar?convite=${invitationToken}`
                  : window.location.origin
                : undefined,
            data: {
              full_name: fullName.trim() || invitationInfo.full_name || 'Técnico de Campo',
              invitation_id: invitationToken,
            },
          },
        });

        // Se o e-mail já estiver cadastrado no Supabase Auth, orienta a usar a senha existente
        if (signUpErr && signUpErr.message.toLowerCase().includes('already registered')) {
          setMode('existing_user');
          setErrorMsg('Este e-mail já possui cadastro. Por favor, insira sua senha existente abaixo para ativar este convite.');
          setSubmitting(false);
          return;
        }

        if (signUpErr) throw signUpErr;

        // Se o Supabase exige confirmação de e-mail e não retornou sessão ativa
        if (signUpData.user && !signUpData.session) {
          setEmailConfirmationRequired(true);
          setSubmitting(false);
          return;
        }
      } else {
        // 4.2 Técnico com conta já existente: autentica com sua senha
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInErr) {
          throw new Error(`Senha incorreta ou erro de autenticação: ${signInErr.message}`);
        }
      }

      // 4.3 Com a sessão autenticada, invoca o RPC para aceitar o convite e amarrar os vínculos
      if (invitationToken) {
        const { error: acceptErr } = await supabase.rpc('accept_company_invitation', {
          p_invitation_id: invitationToken,
        });
        if (acceptErr) {
          if (acceptErr.message.includes('ainda não foi confirmado') || acceptErr.message.toLowerCase().includes('confirm')) {
            setEmailConfirmationRequired(true);
            setSubmitting(false);
            return;
          }
          throw acceptErr;
        }
      }

      setSuccessMsg('Acesso ativado com sucesso! Redirecionando para suas ordens de serviço...');
      await refreshTenantContext();
      setTimeout(() => {
        navigate('/tecnico/ordens', { replace: true });
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao ativar conta.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto" />
          <h2 className="text-base font-bold text-slate-900">Validando Convite de Ativação...</h2>
          <p className="text-xs text-slate-500">
            Verificando credenciais e integridade das permissões junto ao servidor Metrion.
          </p>
        </div>
      </div>
    );
  }

  // Se o convite for inválido ou expirado
  if (!invitationInfo || !invitationInfo.valid) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full text-center space-y-5">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
            {invitationInfo?.expired ? <Clock className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
          </div>

          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {invitationInfo?.already_accepted
                ? 'Convite Já Utilizado'
                : invitationInfo?.expired
                ? 'Convite Expirado'
                : 'Convite Não Encontrado'}
            </h2>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              {invitationInfo?.reason || 'Não foi possível validar este link de ativação.'}
            </p>
          </div>

          <div className="pt-2">
            {invitationInfo?.already_accepted ? (
              <Button
                variant="primary"
                className="w-full justify-center"
                onClick={() => navigate('/login')}
              >
                Ir para Tela de Login
              </Button>
            ) : (
              <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 text-left space-y-1">
                <span className="font-semibold text-slate-700 block">O que fazer agora?</span>
                <span>
                  Entre em contato com o gestor da empresa para que ele clique em <strong>"Reenviar Convite"</strong> no painel de técnicos.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Cenário: Confirmação de e-mail exigida pelo Supabase Auth
  if (emailConfirmationRequired) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full text-center space-y-5">
          <div className="w-12 h-12 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center mx-auto border border-teal-200">
            <Mail className="w-6 h-6" />
          </div>

          <div>
            <h2 className="text-lg font-bold text-slate-900">Confirmação de E-mail Enviada</h2>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Enviamos um link de confirmação para o endereço{' '}
              <strong className="text-slate-900 font-semibold">{invitationInfo.email}</strong>.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Seu convite foi preservado com segurança. Assim que confirmar seu e-mail, acesse a tela de login para começar a utilizar o sistema.
            </p>
          </div>

          <Button
            variant="primary"
            className="w-full justify-center"
            onClick={() => navigate('/login')}
          >
            Ir para a Tela de Login
          </Button>
        </div>
      </div>
    );
  }

  const isUserMatchingLoggedIn =
    loggedInUser &&
    loggedInUser.email?.toLowerCase().trim() === invitationInfo.email?.toLowerCase().trim();

  const isUserDifferentLoggedIn =
    loggedInUser &&
    loggedInUser.email?.toLowerCase().trim() !== invitationInfo.email?.toLowerCase().trim();

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center mb-3">
          <BrandLogo
            name="METRION"
            subtitle="Ativação de Acesso em Campo"
            size="lg"
            variant="light"
          />
        </div>
        <h2 className="text-center text-xl font-bold tracking-tight text-slate-900">
          Ativação de Acesso de Técnico
        </h2>
        <p className="text-center text-xs text-slate-500 mt-1">
          Você foi convidado para integrar a equipe de campo da{' '}
          <strong className="text-teal-700">{invitationInfo.company_name}</strong>.
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-slate-200 sm:px-10 space-y-5">
          {/* Card Resumo do Convite */}
          <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-teal-900 font-semibold">
              <Wrench className="w-4 h-4 text-teal-600" />
              <span>Função: Técnico Autorizado em Campo</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Building className="w-3.5 h-3.5 text-slate-400" />
              <span>Empresa: {invitationInfo.company_name}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              <span>E-mail: {invitationInfo.email}</span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Caso 1: Usuário já está logado com a conta do convite */}
          {isUserMatchingLoggedIn ? (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-xs">
                Você já está conectado como <strong>{loggedInUser.email}</strong>. Clique abaixo para vincular este convite ao seu acesso atual.
              </div>

              <Button
                variant="primary"
                className="w-full justify-center py-2.5"
                isLoading={submitting}
                onClick={handleLinkCurrentAccount}
                leftIcon={<ArrowRight className="w-4 h-4" />}
              >
                Vincular Convite e Acessar
              </Button>
            </div>
          ) : isUserDifferentLoggedIn ? (
            /* Caso 2: Usuário está logado com OUTRA conta */
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs">
                Você está conectado como <strong>{loggedInUser.email}</strong>, mas este convite é exclusivo para <strong>{invitationInfo.email}</strong>.
              </div>

              <Button
                variant="outline"
                className="w-full justify-center py-2.5 text-red-600 border-red-300 hover:bg-red-50"
                onClick={handleSignOutOtherAccount}
                leftIcon={<LogOut className="w-4 h-4" />}
              >
                Desconectar da conta atual
              </Button>
            </div>
          ) : (
            /* Caso 3: Não autenticado - Criação de Senha ou Login Existente */
            <div className="space-y-4">
              {/* Seletor de Modo */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    setMode('new_user');
                    setErrorMsg(null);
                  }}
                  className={`py-1.5 rounded-md transition-colors ${
                    mode === 'new_user'
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Criar Nova Senha
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('existing_user');
                    setErrorMsg(null);
                  }}
                  className={`py-1.5 rounded-md transition-colors ${
                    mode === 'existing_user'
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Já Possuo Conta
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <InputField
                  label="E-mail Autorizado"
                  type="email"
                  value={invitationInfo.email || ''}
                  disabled
                  hint="E-mail vinculado estritamente ao convite da empresa."
                />

                {mode === 'new_user' ? (
                  <>
                    <InputField
                      label="Nome Completo do Técnico"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ex.: Lucas da Silva"
                      required
                    />

                    <InputField
                      label="Crie sua Senha de Acesso"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      required
                      hint="Sua senha é pessoal e criptografada."
                    />

                    <InputField
                      label="Confirmar Senha"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Digite a senha novamente"
                      required
                    />

                    <Button
                      type="submit"
                      variant="primary"
                      className="w-full justify-center py-2.5 mt-2"
                      isLoading={submitting}
                      leftIcon={<ArrowRight className="w-4 h-4" />}
                    >
                      Ativar Minha Conta de Técnico
                    </Button>
                  </>
                ) : (
                  <>
                    <InputField
                      label="Sua Senha Atual"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Digite sua senha cadastrada"
                      required
                      hint="Utilize a senha da sua conta existente."
                    />

                    <Button
                      type="submit"
                      variant="primary"
                      className="w-full justify-center py-2.5 mt-2"
                      isLoading={submitting}
                      leftIcon={<LogIn className="w-4 h-4" />}
                    >
                      Entrar e Ativar Convite
                    </Button>
                  </>
                )}
              </form>
            </div>
          )}

          <div className="pt-2 text-center text-[11px] text-slate-500">
            Protegido por criptografia Supabase Auth e isolamento multi-tenant Metrion.
          </div>
        </div>
      </div>
    </div>
  );
};
