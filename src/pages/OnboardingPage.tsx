import React, { useState } from 'react';
import { Building2, LogOut, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { translateSupabaseError } from '../lib/errors';
import { formatCNPJ } from '../lib/validation';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { BrandLogo } from '../components/ui/BrandLogo';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { InputField } from '../components/ui/FormField';
import { AlertBanner } from '../components/ui/EmptyState';
import { SchemaSetupBanner } from '../components/ui/SchemaSetupBanner';

export const OnboardingPage: React.FC = () => {
  const {
    user,
    profile,
    schemaMissing,
    isPlatformSetupNeeded,
    refreshTenantContext,
    signOut,
  } = useAuthTenant();

  const [companyName, setCompanyName] = useState('EA Balanças');
  const [cnpj, setCnpj] = useState('');
  const [adminName, setAdminName] = useState(
    profile?.full_name ||
      (user?.user_metadata?.full_name as string | undefined) ||
      ''
  );
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (companyName.trim().length < 2) {
      setErrorMsg('Informe o nome da empresa principal (ex.: EA Balanças).');
      return;
    }

    setLoading(true);
    const { error } = await supabase.rpc('bootstrap_initial_platform', {
      p_company_name: companyName.trim(),
      p_document_cnpj: cnpj.trim() || null,
      p_full_name: adminName.trim() || null,
    });
    setLoading(false);

    if (error) {
      setErrorMsg(translateSupabaseError(error));
      return;
    }

    await refreshTenantContext();
  };

  const handleCheckInvites = async () => {
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);
    const { data, error } = await supabase.rpc('claim_my_invitations');
    setLoading(false);

    if (error) {
      setErrorMsg(translateSupabaseError(error));
      return;
    }

    if (Number(data) > 0) {
      await refreshTenantContext();
    } else {
      setInfoMsg(
        'Nenhum convite pendente encontrado para este endereço de e-mail no momento.'
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex flex-col">
      <header className="bg-[#0B2545] text-white px-6 py-4 flex items-center justify-between">
        <BrandLogo name="EA Balanças" primaryColor="#0D9488" variant="dark" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-300 hidden sm:inline">
            {user?.email}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void signOut()}
            leftIcon={<LogOut className="w-3.5 h-3.5" />}
          >
            Sair
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-6">
          {schemaMissing ? (
            <SchemaSetupBanner onRetry={refreshTenantContext} />
          ) : isPlatformSetupNeeded ? (
            <Card
              title="Inicialização da Plataforma SaaS — EA Balanças"
              subtitle="Detectamos que esta instância recém-migrada ainda não possui administrador ou empresa inicial. Configure a empresa matriz abaixo."
            >
              <form onSubmit={handleBootstrap} className="space-y-4">
                {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

                <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-950 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                  <div>
                    Sua conta (<strong>{user?.email}</strong>) receberá o perfil de{' '}
                    <strong>Administrador da Plataforma</strong> e{' '}
                    <strong>Gestor</strong> da empresa inicial. Esta operação é
                    bloqueada automaticamente no PostgreSQL após o primeiro uso.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InputField
                    label="Nome da Empresa Matriz"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                  <InputField
                    label="CNPJ (opcional)"
                    placeholder="00.000.000/0001-00"
                    value={cnpj}
                    onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
                  />
                </div>

                <InputField
                  label="Seu Nome Completo"
                  required
                  placeholder="Nome do Administrador"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                />

                <div className="pt-2 flex justify-end">
                  <Button
                    type="submit"
                    size="lg"
                    isLoading={loading}
                    leftIcon={<Building2 className="w-4 h-4" />}
                  >
                    Inicializar EA Balanças e Acessar Painel
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card
              title="Aguardando Vínculo com uma Empresa"
              subtitle="Proteção Multi-tenant Ativa (Row Level Security)"
            >
              <div className="space-y-4">
                {errorMsg && <AlertBanner variant="error" message={errorMsg} />}
                {infoMsg && <AlertBanner variant="info" message={infoMsg} />}

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3 text-xs text-slate-700 leading-relaxed">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900 mb-1">
                      Sua conta ({user?.email}) está autenticada, mas ainda não foi
                      associada a nenhuma empresa ativa.
                    </p>
                    <p>
                      Por segurança multiempresa, usuários sem vínculo não têm acesso a
                      dados de nenhum tenant. Solicite ao <strong>Gestor</strong> da sua
                      empresa (ou ao <strong>Administrador da Plataforma</strong>) que
                      cadastre um convite para o e-mail <strong>{user?.email}</strong> em{' '}
                      <em>Configurações → Equipe e Permissões</em> ou em{' '}
                      <em>Técnicos</em>.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    isLoading={loading}
                    onClick={handleCheckInvites}
                    leftIcon={<RefreshCw className="w-4 h-4" />}
                  >
                    Verificar Convites para meu E-mail
                  </Button>
                  <Button variant="outline" onClick={() => void signOut()}>
                    Entrar com outra conta
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};
