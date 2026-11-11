/**
 * Tradutor centralizado de erros do Supabase (PostgREST, Auth e Storage)
 * para mensagens claras em português do Brasil.
 */

export function isSchemaMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === 'PGRST205' ||
    e.code === '42P01' ||
    e.code === 'PGRST202' ||
    Boolean(e.message && e.message.includes('Could not find the table')) ||
    Boolean(e.message && e.message.includes('Could not find the function'))
  );
}

export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === 'PGRST204' ||
    e.code === '42703' ||
    Boolean(e.message && /Could not find the .* column/i.test(e.message)) ||
    Boolean(e.message && /column .* does not exist/i.test(e.message))
  );
}

export function translateSupabaseError(err: unknown): string {
  if (!err) return 'Ocorreu um erro inesperado.';

  if (typeof err === 'string') return err;

  const e = err as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };

  if (isSchemaMissingError(e)) {
    return 'As tabelas do banco de dados ainda não foram criadas no projeto Supabase. Execute o script SQL de migração (supabase/migrations/001_initial_schema.sql) no SQL Editor do Supabase.';
  }

  const msg = e.message ?? '';

  // Erros de Autenticação (Supabase Auth)
  if (/Invalid login credentials/i.test(msg)) {
    return 'E-mail ou senha incorretos. Verifique suas credenciais e tente novamente.';
  }
  if (/Email not confirmed/i.test(msg)) {
    return 'Seu e-mail ainda não foi confirmado. Verifique a caixa de entrada (e spam) para clicar no link de confirmação enviado pelo Supabase.';
  }
  if (/User already registered/i.test(msg)) {
    return 'Já existe uma conta cadastrada com este endereço de e-mail.';
  }
  if (/Password should be at least/i.test(msg)) {
    return 'A senha deve possuir no mínimo 6 caracteres.';
  }
  if (/rate limit|too many requests/i.test(msg)) {
    return 'Muitas tentativas em sequência. Aguarde alguns instantes antes de tentar novamente.';
  }

  // Erros PostgreSQL / RLS / Constraints
  switch (e.code) {
    case '42501':
      return 'Permissão negada pelas políticas de segurança (RLS) do banco de dados para o seu perfil ou empresa.';
    case '23505':
      if (/serial_number/i.test(msg) || /serial_number/i.test(e.details ?? '')) {
        return 'Já existe um equipamento cadastrado nesta empresa com este número de série.';
      }
      if (/slug/i.test(msg) || /slug/i.test(e.details ?? '')) {
        return 'Já existe uma empresa utilizando este identificador (slug).';
      }
      if (/uq_company_membership/i.test(msg)) {
        return 'Este usuário já está vinculado a esta empresa.';
      }
      return 'Registro duplicado: já existe um cadastro com estes dados únicos.';
    case '23503':
      return 'Não é possível concluir a operação pois este registro possui vínculos ativos (ex.: ordens de serviço associadas).';
    case '23514':
      return 'Os dados informados violam uma regra de validação do banco de dados (verifique datas, cores ou campos obrigatórios).';
    default:
      break;
  }

  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return 'Falha de comunicação com o servidor Supabase. Verifique sua conexão de rede.';
  }

  return msg || 'Não foi possível concluir a operação no banco de dados.';
}
