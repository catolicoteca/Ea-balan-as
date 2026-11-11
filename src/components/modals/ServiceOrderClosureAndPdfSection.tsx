import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileText,
  Download,
  Share2,
  RotateCcw,
  Lock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import { translateSupabaseError } from '../../lib/errors';
import {
  SIGNATURE_OMITTED_REASONS,
  validateServiceOrderClosure,
} from '../../lib/fieldEvidence';
import {
  parseExecutionMetadata,
  serializeExecutionMetadata,
} from '../../lib/fieldExecution';
import {
  downloadPdfBlob,
  generateServiceOrderPdf,
  sharePdfViaWhatsApp,
} from '../../lib/pdfReport';
import type {
  ServiceOrder,
  ServiceOrderAttachment,
  ServiceOrderExecution,
  ServiceOrderItem,
  ServiceOrderSignature,
  SignatureOmittedReason,
} from '../../types/database';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/EmptyState';

interface ServiceOrderClosureAndPdfSectionProps {
  order: ServiceOrder;
  companyId: string;
  execution: ServiceOrderExecution | null;
  attachments: ServiceOrderAttachment[];
  signatures: ServiceOrderSignature[];
  items: ServiceOrderItem[];
  onOrderUpdated: () => void;
}

export const ServiceOrderClosureAndPdfSection: React.FC<
  ServiceOrderClosureAndPdfSectionProps
> = ({
  order,
  companyId,
  execution,
  attachments,
  signatures,
  items,
  onOrderUpdated,
}) => {
  const { activeCompany, user, permissions } = useAuthTenant();

  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'download' | 'whatsapp' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Justificativa opcional quando o responsável está ausente ou se recusa a assinar
  const [omitSignature, setOmitSignature] = useState(false);
  const [omitReason, setOmitReason] = useState<SignatureOmittedReason | ''>('');
  const [omitNotes, setOmitNotes] = useState('');

  const isClosed = order.status === 'completed';
  const isCancelled = order.status === 'cancelled';
  const hasClientSignature = signatures.some((s) => s.signer_type === 'client');

  const validation = validateServiceOrderClosure({
    execution,
    signatures,
    attachments,
    items,
    signatureOmission: {
      enabled: omitSignature,
      reason: omitReason,
      notes: omitNotes,
    },
  });

  // 1. Concluir Atendimento / Fechar OS
  const handleCompleteOrder = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!validation.valid) {
      setErrorMsg(
        'Preencha todos os requisitos obrigatórios listados acima antes de concluir a OS.'
      );
      return;
    }

    setClosing(true);
    try {
      const nowIso = new Date().toISOString();

      // Se concluiu sem assinatura com justificativa, persiste no JSONB da execução
      if (!hasClientSignature && omitSignature && omitReason && execution?.id) {
        const currentMeta = parseExecutionMetadata(
          execution.calibration_measurements
        );
        const updatedMeta = serializeExecutionMetadata({
          ...currentMeta,
          signature_omitted_reason: omitReason,
          signature_omitted_notes: omitNotes.trim(),
        });

        await supabase
          .from('service_order_executions')
          .update({
            finished_at: nowIso,
            calibration_measurements: updatedMeta,
          })
          .eq('id', execution.id)
          .eq('company_id', companyId);
      } else if (execution?.id) {
        await supabase
          .from('service_order_executions')
          .update({ finished_at: nowIso })
          .eq('id', execution.id)
          .eq('company_id', companyId);
      }

      const { error: osErr } = await supabase
        .from('service_orders')
        .update({
          status: 'completed',
          completed_at: order.completed_at ?? nowIso,
        })
        .eq('id', order.id)
        .eq('company_id', companyId);

      if (osErr) throw osErr;

      const clientSig = signatures.find((s) => s.signer_type === 'client');
      const historyDesc = clientSig
        ? `Atendimento finalizado (Assinado por: ${clientSig.signer_name}).`
        : omitReason
        ? `Atendimento finalizado sem assinatura digital. Justificativa: ${
            SIGNATURE_OMITTED_REASONS[omitReason]
          } — ${omitNotes.trim()}`
        : 'Atendimento finalizado.';

      await supabase.from('service_order_history').insert({
        company_id: companyId,
        service_order_id: order.id,
        actor_user_id: user?.id ?? null,
        event_type: 'order_completed',
        old_status: order.status,
        new_status: 'completed',
        description: historyDesc,
        payload: clientSig
          ? { signer_name: clientSig.signer_name }
          : {
              signature_omitted_reason: omitReason || null,
              signature_omitted_notes: omitNotes.trim() || null,
            },
      });

      setSuccessMsg('Ordem de Serviço concluída e preservada com sucesso!');
      onOrderUpdated();
    } catch (err: unknown) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setClosing(false);
    }
  };

  // 2. Reabrir OS pelo Gestor para Ajustes
  const handleReopenByManager = async () => {
    if (!permissions.canApproveOrderItems) return;
    if (
      !window.confirm(
        'Reabrir esta OS para ajustes técnicos? As fotos e assinatura anteriores serão mantidas no histórico.'
      )
    ) {
      return;
    }

    setReopening(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('service_orders')
        .update({ status: 'in_progress' })
        .eq('id', order.id)
        .eq('company_id', companyId);

      if (error) throw error;

      await supabase.from('service_order_history').insert({
        company_id: companyId,
        service_order_id: order.id,
        actor_user_id: user?.id ?? null,
        event_type: 'order_reopened_by_manager',
        old_status: 'completed',
        new_status: 'in_progress',
        description: 'OS reaberta pelo gestor para revisão técnica.',
      });

      setSuccessMsg('Ordem de Serviço reaberta para ajustes.');
      onOrderUpdated();
    } catch (err: unknown) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setReopening(false);
    }
  };

  // 3. Helper para resolver URLs assinadas frescas e gerar o PDF completo
  const buildFullPdf = async () => {
    // Busca sempre os dados frescos do banco para garantir consistência no PDF
    const [execRes, itemsRes, attRes, sigRes] = await Promise.all([
      supabase
        .from('service_order_executions')
        .select('*')
        .eq('company_id', companyId)
        .eq('service_order_id', order.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('service_order_items')
        .select('*')
        .eq('company_id', companyId)
        .eq('service_order_id', order.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('service_order_attachments')
        .select('*')
        .eq('company_id', companyId)
        .eq('service_order_id', order.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('service_order_signatures')
        .select('*')
        .eq('company_id', companyId)
        .eq('service_order_id', order.id)
        .order('signed_at', { ascending: false }),
    ]);

    const latestExec = (execRes.data as ServiceOrderExecution | null) ?? execution;
    const latestItems = (itemsRes.data as ServiceOrderItem[]) ?? items;
    const latestAtts = (attRes.data as ServiceOrderAttachment[]) ?? attachments;
    const latestSigs = (sigRes.data as ServiceOrderSignature[]) ?? signatures;

    // URLs assinadas das fotos
    const attsWithUrls: Array<ServiceOrderAttachment & { signedUrl?: string }> = [];
    if (latestAtts.length > 0) {
      const { data: signedList } = await supabase.storage
        .from('os-attachments')
        .createSignedUrls(
          latestAtts.map((a) => a.file_path),
          300
        );
      for (const att of latestAtts) {
        const match = signedList?.find((s) => s.path === att.file_path);
        attsWithUrls.push({ ...att, signedUrl: match?.signedUrl ?? undefined });
      }
    }

    // URL assinada da assinatura do cliente
    const clientSig = latestSigs.find((s) => s.signer_type === 'client') ?? null;
    let sigWithUrl: (ServiceOrderSignature & { signedUrl?: string }) | null =
      null;
    if (clientSig) {
      const { data: signedSig } = await supabase.storage
        .from('os-signatures')
        .createSignedUrl(clientSig.signature_file_path, 300);
      sigWithUrl = { ...clientSig, signedUrl: signedSig?.signedUrl ?? undefined };
    }

    return generateServiceOrderPdf({
      company: activeCompany,
      order,
      execution: latestExec,
      items: latestItems,
      attachments: attsWithUrls,
      clientSignature: sigWithUrl,
    });
  };

  const handleDownloadPdf = async () => {
    setPdfBusy('download');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { blob, fileName } = await buildFullPdf();
      downloadPdfBlob(blob, fileName);
      setSuccessMsg(`Relatório "${fileName}" gerado e baixado com sucesso!`);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Falha ao gerar o relatório PDF.'
      );
    } finally {
      setPdfBusy(null);
    }
  };

  const handleSharePdfWhatsApp = async () => {
    setPdfBusy('whatsapp');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { blob, fileName } = await buildFullPdf();
      const res = await sharePdfViaWhatsApp({
        blob,
        fileName,
        order,
        companyName: activeCompany?.name || 'EA Balanças',
      });
      setSuccessMsg(
        res.method === 'native_file_share'
          ? 'Compartilhamento nativo aberto com o arquivo PDF pronto para envio!'
          : `Seu navegador não anexa arquivos automaticamente no WhatsApp Web. O PDF "${fileName}" foi baixado no dispositivo e o WhatsApp foi aberto com os dados e link seguro da OS — basta anexar o arquivo baixado na conversa.`
      );
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Falha ao compartilhar relatório.'
      );
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {errorMsg && <AlertBanner variant="error" message={errorMsg} />}
      {successMsg && <AlertBanner variant="success" message={successMsg} />}

      {/* ==================================================================== */}
      {/* BLOCO A: FECHAMENTO DA OS / REVISÃO DO GESTOR                        */}
      {/* ==================================================================== */}
      <div
        className={`p-4 rounded-xl border space-y-3 ${
          isClosed
            ? 'bg-emerald-50/60 border-emerald-200'
            : isCancelled
            ? 'bg-slate-50 border-slate-200'
            : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            {isClosed ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Atendimento Concluído — Evidências Preservadas
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-teal-700" />
                Conclusão do Atendimento &amp; Fechamento da OS
              </>
            )}
          </h3>

          {isClosed && permissions.canApproveOrderItems && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              isLoading={reopening}
              onClick={() => void handleReopenByManager()}
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              Reabrir OS (Gestor)
            </Button>
          )}
        </div>

        {!isClosed && !isCancelled && (
          <>
            {!validation.valid && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  Requisitos pendentes para finalizar a OS:
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-amber-900/90">
                  {validation.missingFields.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <div className="font-semibold flex items-center gap-1 text-slate-700">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Observações antes do encerramento:
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {validation.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Opção de justificativa caso o responsável não possa assinar */}
            {!hasClientSignature && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={omitSignature}
                    onChange={(e) => {
                      setOmitSignature(e.target.checked);
                      if (!e.target.checked) {
                        setOmitReason('');
                        setOmitNotes('');
                      }
                    }}
                    className="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-800 block">
                      Não foi possível coletar assinatura do cliente (finalizar com justificativa)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      O padrão recomendado é coletar a assinatura acima. Use esta opção apenas se o responsável estiver ausente ou se recusar a assinar.
                    </span>
                  </div>
                </label>

                {omitSignature && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Motivo Oficial *
                      </label>
                      <select
                        value={omitReason}
                        onChange={(e) =>
                          setOmitReason(e.target.value as SignatureOmittedReason | '')
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        <option value="">Selecione o motivo...</option>
                        <option value="client_absent">
                          {SIGNATURE_OMITTED_REASONS.client_absent}
                        </option>
                        <option value="client_refused">
                          {SIGNATURE_OMITTED_REASONS.client_refused}
                        </option>
                        <option value="other">
                          {SIGNATURE_OMITTED_REASONS.other}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Justificativa / Nome de quem acompanhou no local (mín. 5 caracteres) *
                      </label>
                      <textarea
                        rows={2}
                        value={omitNotes}
                        onChange={(e) => setOmitNotes(e.target.value)}
                        placeholder="Ex.: Responsável saiu antes do término; portaria conferiu e liberou saída às 15h30."
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <Button
              type="button"
              variant="primary"
              disabled={!validation.valid}
              isLoading={closing}
              onClick={() => void handleCompleteOrder()}
              leftIcon={<CheckCircle2 className="w-4 h-4" />}
              className="w-full justify-center py-3 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700"
            >
              Concluir Atendimento (Finalizar OS)
            </Button>
          </>
        )}

        {isClosed && (
          <p className="text-xs text-emerald-900/90">
            Esta OS foi encerrada em{' '}
            {order.completed_at
              ? new Date(order.completed_at).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : 'campo'}
            . Fotos, assinatura, checklist e histórico estão protegidos contra alterações.
          </p>
        )}
      </div>

      {/* ==================================================================== */}
      {/* BLOCO B: RELATÓRIO PDF PROFISSIONAL & WHATSAPP                       */}
      {/* ==================================================================== */}
      <div className="p-4 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/50 to-white space-y-3">
        <div>
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-teal-700" />
            Relatório Técnico em PDF (Padrão A4)
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Gera documento completo com logotipo da empresa, cliente, balança, GPS, checklist, peças, fotos e assinatura.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Button
            type="button"
            variant="outline"
            isLoading={pdfBusy === 'download'}
            onClick={() => void handleDownloadPdf()}
            leftIcon={<Download className="w-4 h-4 text-teal-700" />}
            className="w-full justify-center py-2.5 border-teal-300 text-teal-900 hover:bg-teal-50"
          >
            Baixar Relatório PDF
          </Button>

          <Button
            type="button"
            variant="primary"
            isLoading={pdfBusy === 'whatsapp'}
            onClick={() => void handleSharePdfWhatsApp()}
            leftIcon={<Share2 className="w-4 h-4" />}
            className="w-full justify-center py-2.5 bg-emerald-600 hover:bg-emerald-700"
          >
            Compartilhar no WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
};
