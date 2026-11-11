import React, { useState } from 'react';
import { ShieldCheck, Lock, Mail, CheckCircle2 } from 'lucide-react';
import { supabase, supabaseConfigStatus } from '../lib/supabase';
import { translateSupabaseError } from '../lib/errors';
import { loginSchema, signUpSchema, zodErrorsToMap } from '../lib/validation';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { BrandLogo } from '../components/ui/BrandLogo';
import { Button } from '../components/ui/Button';
import { InputField } from '../components/ui/FormField';
import { AlertBanner } from '../components/ui/EmptyState';
import { SchemaSetupBanner } from '../components/ui/SchemaSetupBanner';

type AuthMode = 'login' | 'signup' | 'recovery';

export const AuthPage: React.FC = () => {
  const { schemaMissing, refreshTenantContext } = useAuthTenant();

  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setFieldErrors({});
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!supabaseConfigStatus.valid) {
      setErrorMsg(supabaseConfigStatus.reason ?? 'Configuração Supabase inválida.');
      return;
    }

    if (mode === 'login') {
      const parsed = loginSchema.safeParse({ email, password });
      if (!parsed.success) {
        setFieldErrors(zodErrorsToMap(parsed.error));
        return;
      }

      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      setLoading(false);

      if (error) {
        setErrorMsg(translateSupabaseError(error));
      }
      return;
    }

    if (mode === 'signup') {
      const parsed = signUpSchema.safeParse({
        fullName,
        email,
        password,
        confirmPassword,
      });
      if (!parsed.success) {
        setFieldErrors(zodErrorsToMap(parsed.error));
        return;
      }

      setLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo:
            typeof window !== 'undefined' ? window.location.origin : undefined,
          data: {
            full_name: parsed.data.fullName,
          },
        },
      });
      setLoading(false);

      if (error) {
        setErrorMsg(translateSupabaseError(error));
        return;
      }

      if (data.user && !data.session) {
        setSuccessMsg(
          'Conta criada com sucesso! O Supabase enviou um link de confirmação para o seu e-mail. Confirme o endereço de e-mail para liberar o acesso.'
        );
        setPassword('');
        setConfirmPassword('');
      }
      return;
    }

    // Recuperação de senha
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldErrors({ email: 'Informe um e-mail válido para recuperação.' });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setLoading(false);

    if (error) {
      setErrorMsg(translateSupabaseError(error));
    } else {
      setSuccessMsg(
        'Instruções de redefinição de senha enviadas! Verifique sua caixa de entrada.'
      );
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F4F7FA]">
      {/* Painel Institucional Azul-Marinho */}
      <div className="lg:col-span-5 bg-[#0B2545] text-white p-8 sm:p-12 flex flex-col justify-between relative overflow-hidden">
        <div
          className="absolute -right-24 -bottom-24 w-80 h-80 rounded-full opacity-15 pointer-events-none"
          style={{
            background: 'radial-gradient(circle, #14B8A6 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10">
          <BrandLogo
            name="METRION"
            subtitle="Gestão de Assistência Técnica & Metrologia"
            primaryColor="#0D9488"
            size="lg"
            variant="dark"
          />

          <div className="mt-10 space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-teal-500/15 text-teal-200 border border-teal-400/25">
              <ShieldCheck className="w-3.5 h-3.5" />
              Metrion • Plataforma SaaS Multi-tenant
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug">
              Gestão Corporativa de Assistência Técnica e Metrologia em Campo
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed max-w-md">
              Controle integrado de clientes, parques de balanças, ordens de serviço,
              agenda técnica e rastreabilidade por empresa com isolamento em banco de
              dados (Row Level Security).
            </p>
          </div>

          <ul className="mt-8 space-y-3 text-xs text-slate-200/90">
            <li className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
              Isolamento rigoroso entre empresas e unidades de atendimento
            </li>
            <li className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
              Perfis dedicados para Administrador, Gestor e Técnico de Campo
            </li>
            <li className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
              Identidade visual personalizável (nome, logotipo e paleta por empresa)
            </li>
          </ul>
        </div>

        <div className="relative z-10 pt-8 mt-8 border-t border-white/10 text-xs text-slate-400 flex items-center justify-between gap-2">
          <span>METRION • SaaS B2B</span>
          <span className="flex items-center gap-1 text-teal-300">
            <Lock className="w-3.5 h-3.5" />
            Supabase Auth + PostgreSQL RLS
          </span>
        </div>
      </div>

      {/* Área de Autenticação */}
      <div className="lg:col-span-7 flex flex-col justify-center p-6 sm:p-12">
        <div className="w-full max-w-md mx-auto space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {mode === 'login' && 'Acessar o Metrion'}
                {mode === 'signup' && 'Criar conta no Metrion'}
                {mode === 'recovery' && 'Recuperar senha'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'login' &&
                  'Entre com seu e-mail corporativo e senha cadastrados para acessar sua empresa.'}
                {mode === 'signup' &&
                  'Cadastre seu usuário. O primeiro acesso inicializa sua empresa no Metrion; demais usuários recebem vínculo por convite.'}
                {mode === 'recovery' &&
                  'Enviaremos um link seguro de redefinição para o seu e-mail.'}
              </p>
            </div>

            {!supabaseConfigStatus.valid && (
              <AlertBanner
                variant="error"
                title="Configuração Pendente"
                message={supabaseConfigStatus.reason ?? 'Verifique as variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'}
              />
            )}

            {errorMsg && <AlertBanner variant="error" message={errorMsg} />}
            {successMsg && <AlertBanner variant="success" message={successMsg} />}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {mode === 'signup' && (
                <InputField
                  label="Nome Completo"
                  required
                  placeholder="Ex.: Eduardo Almeida"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  error={fieldErrors.fullName}
                />
              )}

              <InputField
                label="E-mail Corporativo"
                type="email"
                required
                autoComplete="email"
                placeholder="voce@suaempresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={fieldErrors.email}
              />

              {mode !== 'recovery' && (
                <InputField
                  label="Senha"
                  type="password"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="Mínimo de 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={fieldErrors.password}
                />
              )}

              {mode === 'signup' && (
                <InputField
                  label="Confirmar Senha"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={fieldErrors.confirmPassword}
                />
              )}

              <Button
                type="submit"
                size="lg"
                isLoading={loading}
                className="w-full"
                leftIcon={<Mail className="w-4 h-4" />}
              >
                {mode === 'login' && 'Entrar no Sistema'}
                {mode === 'signup' && 'Cadastrar Usuário'}
                {mode === 'recovery' && 'Enviar Link de Recuperação'}
              </Button>
            </form>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
              {mode === 'login' ? (
                <>
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="font-semibold text-teal-700 hover:text-teal-800"
                  >
                    Criar nova conta
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('recovery')}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    Esqueci minha senha
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-semibold text-teal-700 hover:text-teal-800"
                >
                  ← Voltar para o login
                </button>
              )}
            </div>
          </div>

          {schemaMissing && (
            <SchemaSetupBanner onRetry={refreshTenantContext} />
          )}
        </div>
      </div>
    </div>
  );
};
