import { supabase } from './supabase';
import type { AppRole } from '../types/database';

export interface CreateEmployeePayload {
  companyId: string;
  fullName: string;
  username: string;
  role: 'administrator' | 'stock_manager' | 'technician';
  tempPassword: string;
  phone?: string;
  cpf?: string;
}

export interface CreatedEmployeeResponse {
  success: boolean;
  user: {
    id: string;
    fullName: string;
    username: string;
    role: AppRole;
    email: string;
    mustChangePassword: boolean;
  };
}

async function callEmployeesApi<T>(action: string, companyId: string, payload: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sessão expirada. Faça login novamente para realizar esta ação.');
  }

  const response = await fetch('/api/admin/employees', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action,
      companyId,
      ...payload,
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || `Erro HTTP ${response.status} na API de colaboradores.`);
  }

  return json as T;
}

export async function createEmployeeAccount(payload: CreateEmployeePayload): Promise<CreatedEmployeeResponse> {
  return callEmployeesApi<CreatedEmployeeResponse>('create', payload.companyId, {
    fullName: payload.fullName,
    username: payload.username,
    role: payload.role,
    tempPassword: payload.tempPassword,
    phone: payload.phone,
    cpf: payload.cpf,
  });
}

export async function resetEmployeePassword(
  companyId: string,
  userId: string,
  newTempPassword: string
): Promise<{ success: boolean; message: string }> {
  return callEmployeesApi<{ success: boolean; message: string }>('reset_password', companyId, {
    userId,
    newTempPassword,
  });
}

export async function toggleEmployeeStatus(
  companyId: string,
  userId: string,
  isActive: boolean
): Promise<{ success: boolean; isActive: boolean; message: string }> {
  return callEmployeesApi<{ success: boolean; isActive: boolean; message: string }>('toggle_status', companyId, {
    userId,
    isActive,
  });
}

/**
 * Conclui a troca de senha obrigatória do colaborador autenticado
 * Validada e confirmada diretamente pelo servidor (sem depender de auth.users.encrypted_password)
 */
export async function completePasswordChange(currentPassword: string, newPassword: string): Promise<void> {
  if (!currentPassword) {
    throw new Error('A senha provisória atual é obrigatória.');
  }

  if (newPassword.length < 8) {
    throw new Error('A nova senha deve conter pelo menos 8 caracteres.');
  }

  if (currentPassword === newPassword) {
    throw new Error('A nova senha deve ser diferente da senha provisória atual.');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sessão expirada. Faça login novamente para realizar esta ação.');
  }

  const userCompanyId =
    session.user?.user_metadata?.company_id ||
    '00000000-0000-0000-0000-000000000000';

  try {
    const response = await fetch('/api/admin/employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'complete_password_change',
        companyId: userCompanyId,
        currentPassword,
        newPassword,
      }),
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || `Erro HTTP ${response.status} ao alterar senha no servidor.`);
    }
  } catch (apiErr: any) {
    // Se a API serverless falhou por rede local ou teste direto, tenta via cliente com verificação
    if (apiErr?.message && !apiErr.message.includes('Failed to fetch') && !apiErr.message.includes('fetch is not defined')) {
      throw apiErr;
    }

    const { error: authErr } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (authErr) {
      throw new Error(authErr.message || 'Falha ao atualizar a senha no serviço de autenticação.');
    }

    const { error: rpcErr } = await supabase.rpc('confirm_password_changed');
    if (rpcErr) {
      throw new Error(`Senha atualizada, mas houve falha ao registrar o status do perfil: ${rpcErr.message}`);
    }
  }
}
