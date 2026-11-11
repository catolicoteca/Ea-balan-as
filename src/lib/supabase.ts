import { createClient } from '@supabase/supabase-js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const rawAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

/**
 * Valida que nenhuma chave administrativa (service_role ou sb_secret_) foi
 * acidentalmente exposta nas variáveis públicas do frontend.
 */
export function validatePublicSupabaseConfig(url: string, key: string): {
  valid: boolean;
  reason?: string;
} {
  if (!url || !key) {
    return {
      valid: false,
      reason:
        'Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas (defina no .env local ou em Environment Variables na Vercel e refaça o deploy).',
    };
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) {
    return {
      valid: false,
      reason: 'VITE_SUPABASE_URL não possui um formato válido de projeto Supabase.',
    };
  }

  if (key.startsWith('sb_secret_')) {
    return {
      valid: false,
      reason:
        'BLOQUEIO DE SEGURANÇA: Uma chave secreta administrativa (sb_secret_...) foi detectada no frontend. Use exclusivamente a chave pública (sb_publishable_... ou anon).',
    };
  }

  // Caso seja um JWT clássico do Supabase, inspeciona o claim "role"
  if (key.split('.').length === 3) {
    try {
      const payloadBase64 = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(atob(payloadBase64)) as { role?: string };
      if (decoded.role === 'service_role') {
        return {
          valid: false,
          reason:
            'BLOQUEIO DE SEGURANÇA: Chave service_role detectada no frontend. Substitua imediatamente pela chave pública anon/publishable.',
        };
      }
    } catch {
      // Se não for decodificável como JSON, segue validação padrão do SDK
    }
  }

  return { valid: true };
}

export const supabaseConfigStatus = validatePublicSupabaseConfig(rawUrl, rawAnonKey);
export const SUPABASE_PROJECT_URL = rawUrl;

export const supabase = createClient(
  supabaseConfigStatus.valid ? rawUrl : 'https://placeholder-invalid.supabase.co',
  supabaseConfigStatus.valid ? rawAnonKey : 'public-placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
