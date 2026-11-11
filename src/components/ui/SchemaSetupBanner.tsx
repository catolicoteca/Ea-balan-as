import React, { useState } from 'react';
import { Copy, Check, Database, RefreshCw, ExternalLink } from 'lucide-react';
import migrationSql from '../../../supabase/migrations/001_initial_schema.sql?raw';
import { SUPABASE_PROJECT_URL } from '../../lib/supabase';
import { Button } from './Button';

interface SchemaSetupBannerProps {
  onRetry: () => Promise<void>;
  compact?: boolean;
}

export const SchemaSetupBanner: React.FC<SchemaSetupBannerProps> = ({
  onRetry,
  compact = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showSqlPreview, setShowSqlPreview] = useState(false);

  const projectRef =
    SUPABASE_PROJECT_URL.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] ?? '';
  const sqlEditorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : 'https://supabase.com/dashboard';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(migrationSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setShowSqlPreview(true);
    }
  };

  const handleRetry = async () => {
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/95 p-4 text-amber-950 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-100 text-amber-800 shrink-0">
          <Database className="w-5 h-5" />
        </div>
        <div className="space-y-1 text-xs leading-relaxed flex-1">
          <div className="font-semibold text-sm text-amber-950">
            Migração Inicial Pendente no Banco Supabase ({projectRef || ' Conectado'})
          </div>
          <p className="text-amber-900/90">
            A aplicação já está conectada ao projeto Supabase com chave pública segura (sem expor{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">service_role</code> no frontend).
            Para criar as 15 tabelas multi-tenant, gatilhos, funções e políticas{' '}
            <strong>Row Level Security (RLS)</strong>, execute o arquivo{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">
              supabase/migrations/001_initial_schema.sql
            </code>{' '}
            no <strong>SQL Editor</strong> do seu painel Supabase.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-11">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleCopy}
          leftIcon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        >
          {copied ? 'SQL Copiado!' : 'Copiar SQL Completo (001_initial_schema.sql)'}
        </Button>

        <a
          href={sqlEditorUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-amber-300 text-amber-900 hover:bg-amber-100/60 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Abrir SQL Editor no Supabase
        </a>

        <Button
          type="button"
          size="sm"
          variant="outline"
          isLoading={checking}
          onClick={handleRetry}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Verificar Tabelas Novamente
        </Button>

        {!compact && (
          <button
            type="button"
            onClick={() => setShowSqlPreview((v) => !v)}
            className="text-xs underline text-amber-900 hover:text-amber-950 ml-1"
          >
            {showSqlPreview ? 'Ocultar SQL' : 'Ver código SQL'}
          </button>
        )}
      </div>

      {showSqlPreview && (
        <div className="pl-0 sm:pl-11">
          <textarea
            readOnly
            value={migrationSql}
            rows={8}
            className="w-full font-mono text-[11px] bg-slate-900 text-slate-100 p-3 rounded-lg border border-slate-700"
          />
        </div>
      )}
    </div>
  );
};
