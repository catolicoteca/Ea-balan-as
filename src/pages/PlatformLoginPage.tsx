import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { translateSupabaseError } from '../lib/errors';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { Button } from '../components/ui/Button';
import { InputField } from '../components/ui/FormField';
import { AlertBanner } from '../components/ui/EmptyState';
import { ThemeToggle } from '../components/ui/ThemeToggle';

export const PlatformLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { isPlatformAdmin, refreshTenantContext } = useAuthTenant();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Se já estiver autenticado e for platform_admin, vai direto para /platform
  React.useEffect(() => {
    if (isPlatformAdmin) {
      navigate('/platform/overview', { replace: true });
    }
  }, [isPlatformAdmin, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMsg('Informe o e-mail de administrador da plataforma.');
      return;
    }
    if (!password) {
      setErrorMsg('Informe sua senha administrativa.');
      return;
    }

    setLoading(true);

    try {
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (authErr || !authData.user) {
        setLoading(false);
        setErrorMsg(authErr ? translateSupabaseError(authErr) : 'Credenciais inválidas.');
        return;
      }

      // Validação estrita: verifica se o usuário é realmente platform_admin no banco
      const { data: isAdmin, error: adminErr } = await supabase.rpc('is_platform_admin');

      if (adminErr || !isAdmin) {
        // Desconecta imediatamente se não for platform_admin
        await supabase.auth.signOut();
        setLoading(false);
        setErrorMsg('Acesso restrito: este usuário não possui credenciais de Administrador da Plataforma.');
        return;
      }

      await refreshTenantContext();
      navigate('/platform/overview', { replace: true });
    } catch (err: unknown) {
      setLoading(false);
      setErrorMsg(err instanceof Error ? err.message : 'Falha na autenticação da plataforma.');
    }
  };

  return (
    <div className="min-h-screen bg-[#070F1D] text-slate-100 flex flex-col justify-between p-4 sm:p-6 relative overflow-hidden">
      {/* Elementos visuais de fundo */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-teal-500/10 to-transparent blur-3xl pointer-events-none" />

      {/* Topo com alternador de tema */}
      <div className="w-full max-w-md mx-auto flex items-center justify-between z-10 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-extrabold tracking-wider text-white">METRION</div>
            <div className="text-[10px] text-teal-400/80 font-mono">PLATFORM ROOT</div>
          </div>
        </div>

        <ThemeToggle variant="compact" />
      </div>

      {/* Cartão Central de Login */}
      <div className="w-full max-w-md mx-auto my-auto z-10 py-8">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-6">
          <div className="space-y-1.5 text-center">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-semibold mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              Painel Exclusivo do Proprietário
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Acesso Global da Plataforma
            </h1>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Ambiente restrito para governança de planos, empresas assinantes e infraestrutura SaaS.
            </p>
          </div>

          {errorMsg && (
            <AlertBanner
              variant="error"
              title="Acesso Negado"
              message={errorMsg}
            />
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <InputField
              label="E-mail de Administrador Global"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@metrion.com.br"
              className="bg-slate-950/60 border-slate-700 text-white placeholder-slate-500"
            />

            <InputField
              label="Senha Administrativa"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="bg-slate-950/60 border-slate-700 text-white placeholder-slate-500"
            />

            <Button
              type="submit"
              isLoading={loading}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-semibold shadow-lg shadow-teal-900/30"
              leftIcon={<ArrowRight className="w-4 h-4" />}
            >
              Entrar na Plataforma
            </Button>
          </form>

          <div className="pt-4 border-t border-slate-800 text-center">
            <a
              href="/"
              className="text-xs text-slate-400 hover:text-teal-400 transition-colors"
            >
              ← Ir para o login operacional de empresas
            </a>
          </div>
        </div>
      </div>

      {/* Rodapé informativo */}
      <div className="w-full max-w-md mx-auto text-center z-10 pb-4">
        <p className="text-[11px] text-slate-400">
          Metrion SaaS 2.0 • Sistema Multiempresa de Assistência Técnica
        </p>
      </div>
    </div>
  );
};
