import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

// Obtenção segura das variáveis de ambiente no servidor
function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Configuração de servidor incompleta: SUPABASE_SERVICE_ROLE_KEY ausente.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getSupabaseUserClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Configuração de servidor incompleta: VITE_SUPABASE_ANON_KEY ausente.');
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Utilitário para parsear JSON em Serverless Functions
async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('JSON inválido no corpo da requisição'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Método não permitido. Utilize POST.' });
  }

  try {
    // 1. Validar Bearer Token do Gestor
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return sendJson(res, 401, { error: 'Acesso não autorizado: token Bearer obrigatório.' });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = getSupabaseUserClient();
    const { data: userData, error: userAuthErr } = await userClient.auth.getUser(token);

    if (userAuthErr || !userData.user) {
      return sendJson(res, 401, { error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }

    const callerUser = userData.user;
    const body = (req.body && typeof req.body === 'object') ? req.body : await parseBody(req);
    const { action, companyId } = body as { action?: string; companyId?: string };

    if (!companyId || typeof companyId !== 'string') {
      return sendJson(res, 400, { error: 'Identificador da empresa (companyId) obrigatório.' });
    }

    const adminClient = getSupabaseAdmin();

    // 2. Autorização Rigorosa: Gestor Ativo da Empresa Solicitada (Isolamento Multi-tenant)
    const { data: callerMembership, error: memErr } = await adminClient
      .from('company_memberships')
      .select('id, role, is_active')
      .eq('company_id', companyId)
      .eq('user_id', callerUser.id)
      .eq('is_active', true)
      .maybeSingle();

    if (memErr || !callerMembership || callerMembership.role !== 'manager') {
      return sendJson(res, 403, {
        error: 'Acesso negado: apenas o gestor ativo desta empresa pode gerenciar acessos de colaboradores.',
      });
    }

    // ------------------------------------------------------------------------
    // AÇÃO 1: CRIAR NOVO COLABORADOR POR IDENTIFICADOR E SENHA PROVISÓRIA
    // ------------------------------------------------------------------------
    if (action === 'create') {
      const {
        fullName,
        username,
        role,
        tempPassword,
        phone,
        cpf,
      } = body as {
        fullName?: string;
        username?: string;
        role?: 'administrator' | 'technician';
        tempPassword?: string;
        phone?: string;
        cpf?: string;
      };

      if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 3) {
        return sendJson(res, 400, { error: 'Nome completo deve ter pelo menos 3 caracteres.' });
      }

      if (!username || typeof username !== 'string') {
        return sendJson(res, 400, { error: 'Identificador (usuário) é obrigatório.' });
      }

      const cleanUsername = username.trim().toLowerCase();
      if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
        return sendJson(res, 400, {
          error: 'Identificador inválido: utilize de 3 a 30 caracteres alfanuméricos, pontos, traços ou sublinhados.',
        });
      }

      if (role !== 'administrator' && role !== 'technician') {
        return sendJson(res, 400, {
          error: 'Perfil inválido: escolha entre Administrador ou Técnico.',
        });
      }

      if (!tempPassword || typeof tempPassword !== 'string' || tempPassword.length < 8) {
        return sendJson(res, 400, {
          error: 'A senha provisória deve conter no mínimo 8 caracteres.',
        });
      }

      // Consulta slug da empresa
      const { data: company, error: compErr } = await adminClient
        .from('companies')
        .select('id, slug, is_active')
        .eq('id', companyId)
        .single();

      if (compErr || !company) {
        return sendJson(res, 404, { error: 'Empresa não encontrada.' });
      }

      // Verifica se o identificador já está em uso nesta empresa
      const { data: existingUser } = await adminClient
        .from('company_memberships')
        .select('id')
        .eq('company_id', companyId)
        .eq('username', cleanUsername)
        .maybeSingle();

      if (existingUser) {
        return sendJson(res, 409, {
          error: `O identificador "${cleanUsername}" já está em uso nesta empresa. Escolha outro.`,
        });
      }

      // E-mail sintético transparente scoped por empresa
      const syntheticEmail = `${cleanUsername}.${company.slug}@auth.metrion.internal`;

      // Criação segura via Supabase Admin API (sem RPC SQL e sem plain-text password)
      const { data: createdAuth, error: createAuthErr } = await adminClient.auth.admin.createUser({
        email: syntheticEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: fullName.trim(),
          company_id: companyId,
          username: cleanUsername,
        },
      });

      if (createAuthErr || !createdAuth.user) {
        return sendJson(res, 400, {
          error: `Erro ao criar credencial administrativa: ${createAuthErr?.message || 'Falha desconhecida'}`,
        });
      }

      const newUserId = createdAuth.user.id;

      // Atualiza perfil marcando troca de senha obrigatória (must_change_password)
      await adminClient.from('profiles').upsert({
        id: newUserId,
        full_name: fullName.trim(),
        email: syntheticEmail,
        phone: phone ? phone.trim() : null,
        default_company_id: companyId,
        must_change_password: true,
      });

      // Vincula na associação de membros da empresa
      const { error: memInsertErr } = await adminClient.from('company_memberships').insert({
        company_id: companyId,
        user_id: newUserId,
        role: role,
        username: cleanUsername,
        is_active: true,
        invited_by: callerUser.id,
      });

      if (memInsertErr) {
        // Rollback defensivo
        await adminClient.auth.admin.deleteUser(newUserId);
        return sendJson(res, 500, {
          error: `Erro ao associar usuário à empresa: ${memInsertErr.message}`,
        });
      }

      // Se for técnico, registra na tabela technicians
      if (role === 'technician') {
        await adminClient.from('technicians').insert({
          company_id: companyId,
          user_id: newUserId,
          full_name: fullName.trim(),
          email: syntheticEmail,
          phone: phone ? phone.trim() : null,
          cpf: cpf ? cpf.trim() : null,
          is_active: true,
          can_view_all_os: false,
        });
      }

      return sendJson(res, 201, {
        success: true,
        user: {
          id: newUserId,
          fullName: fullName.trim(),
          username: cleanUsername,
          role,
          email: syntheticEmail,
          mustChangePassword: true,
        },
      });
    }

    // ------------------------------------------------------------------------
    // AÇÃO 2: REDEFINIR SENHA PROVISÓRIA (TROCA OBRIGATÓRIA NO PRÓXIMO ACESSO)
    // ------------------------------------------------------------------------
    if (action === 'reset_password') {
      const { userId, newTempPassword } = body as {
        userId?: string;
        newTempPassword?: string;
      };

      if (!userId || typeof userId !== 'string') {
        return sendJson(res, 400, { error: 'Identificador do usuário alvo (userId) obrigatório.' });
      }

      if (!newTempPassword || typeof newTempPassword !== 'string' || newTempPassword.length < 8) {
        return sendJson(res, 400, {
          error: 'A nova senha provisória deve conter no mínimo 8 caracteres.',
        });
      }

      // Verifica se o usuário alvo pertence a esta empresa e não é outro gestor
      const { data: targetMem, error: targetMemErr } = await adminClient
        .from('company_memberships')
        .select('id, role')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .maybeSingle();

      if (targetMemErr || !targetMem) {
        return sendJson(res, 404, {
          error: 'Colaborador não encontrado nesta empresa.',
        });
      }

      // Gestor não pode redefinir senha de outro gestor desta forma
      if (targetMem.role === 'manager' && userId !== callerUser.id) {
        return sendJson(res, 403, {
          error: 'Não é permitido redefinir a senha de outro gestor diretamente.',
        });
      }

      // Atualiza senha pelo Supabase Admin API
      const { error: resetErr } = await adminClient.auth.admin.updateUserById(userId, {
        password: newTempPassword,
      });

      if (resetErr) {
        return sendJson(res, 400, {
          error: `Erro ao redefinir senha no Supabase: ${resetErr.message}`,
        });
      }

      // Força troca de senha no primeiro login pós-redefinição
      await adminClient
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', userId);

      return sendJson(res, 200, {
        success: true,
        message: 'Senha provisória redefinida com sucesso. O colaborador deverá trocá-la no próximo acesso.',
      });
    }

    // ------------------------------------------------------------------------
    // AÇÃO 3: BLOQUEAR OU REATIVAR CONTA DE COLABORADOR
    // ------------------------------------------------------------------------
    if (action === 'toggle_status') {
      const { userId, isActive } = body as {
        userId?: string;
        isActive?: boolean;
      };

      if (!userId || typeof userId !== 'string') {
        return sendJson(res, 400, { error: 'Identificador do usuário alvo (userId) obrigatório.' });
      }

      if (typeof isActive !== 'boolean') {
        return sendJson(res, 400, { error: 'O parâmetro isActive (booleano) é obrigatório.' });
      }

      if (userId === callerUser.id) {
        return sendJson(res, 400, { error: 'Você não pode desativar o seu próprio acesso de gestor.' });
      }

      // Atualiza membership
      const { error: updateMemErr } = await adminClient
        .from('company_memberships')
        .update({ is_active: isActive })
        .eq('company_id', companyId)
        .eq('user_id', userId);

      if (updateMemErr) {
        return sendJson(res, 400, { error: updateMemErr.message });
      }

      // Atualiza registro de técnico se houver
      await adminClient
        .from('technicians')
        .update({ is_active: isActive })
        .eq('company_id', companyId)
        .eq('user_id', userId);

      // Se a conta estiver sendo desativada, revoga imediatamente todas as sessões ativas no Supabase Auth
      if (!isActive) {
        try {
          await adminClient.auth.admin.signOut(userId, 'global');
        } catch {
          // Ignora se o usuário não possuir sessão ativa no momento
        }
      }

      return sendJson(res, 200, {
        success: true,
        isActive,
        message: isActive
          ? 'Conta do colaborador reativada com sucesso.'
          : 'Conta do colaborador desativada com sucesso e todas as sessões ativas foram encerradas.',
      });
    }

    return sendJson(res, 400, { error: `Ação não reconhecida: "${action}".` });
  } catch (err: any) {
    return sendJson(res, 500, {
      error: `Erro interno no processamento de colaboradores: ${err?.message || 'Falha não especificada'}`,
    });
  }
}
