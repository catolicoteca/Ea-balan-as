import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PenTool,
  RotateCcw,
  CheckCircle2,
  Lock,
  Loader2,
  UserCheck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { translateSupabaseError } from '../../lib/errors';
import { buildOrderStoragePath } from '../../lib/fieldEvidence';
import type { ServiceOrder, ServiceOrderSignature } from '../../types/database';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/EmptyState';

interface ServiceOrderSignatureSectionProps {
  order: ServiceOrder;
  companyId: string;
  executionId?: string | null;
  onSignaturesChanged?: (signatures: ServiceOrderSignature[]) => void;
}

export const ServiceOrderSignatureSection: React.FC<
  ServiceOrderSignatureSectionProps
> = ({ order, companyId, executionId, onSignaturesChanged }) => {
  const [signatures, setSignatures] = useState<ServiceOrderSignature[]>([]);
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const [signerName, setSignerName] = useState('');
  const [signerDocument, setSignerDocument] = useState('');
  const [signerRole, setSignerRole] = useState('Responsável pelo Recebimento');
  const [hasDrawn, setHasDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);

  const isClosed = order.status === 'completed' || order.status === 'cancelled';

  const loadSignatures = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    const { data, error } = await supabase
      .from('service_order_signatures')
      .select('*')
      .eq('company_id', companyId)
      .eq('service_order_id', order.id)
      .order('signed_at', { ascending: false });

    if (error) {
      setErrorMsg(translateSupabaseError(error));
      setLoading(false);
      return;
    }

    const list = (data as ServiceOrderSignature[]) ?? [];
    setSignatures(list);
    onSignaturesChanged?.(list);

    const latestClientSig = list.find((s) => s.signer_type === 'client');
    if (latestClientSig) {
      const { data: signed } = await supabase.storage
        .from('os-signatures')
        .createSignedUrl(latestClientSig.signature_file_path, 3600);

      setSignedImageUrl(signed?.signedUrl ?? null);
    } else {
      setSignedImageUrl(null);
    }

    setLoading(false);
  }, [companyId, onSignaturesChanged, order.id]);

  useEffect(() => {
    void loadSignatures();
  }, [loadSignatures]);

  // Configura canvas responsivo com suporte DPI para traço nítido no celular
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(rect.width, 300) * dpr;
    canvas.height = 170 * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0F172A';
    }
    setHasDrawn(false);
  }, []);

  const latestClientSig = signatures.find((s) => s.signer_type === 'client') ?? null;
  const showCanvas = !isClosed && (!latestClientSig || replacing);

  useEffect(() => {
    if (showCanvas) {
      const timer = setTimeout(initCanvas, 50);
      return () => clearTimeout(timer);
    }
  }, [initCanvas, showCanvas]);

  const getPointerCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!showCanvas) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getPointerCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { x, y } = getPointerCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawn(false);
  };

  const handleSaveSignature = async () => {
    setErrorMsg(null);

    if (signerName.trim().length < 2) {
      setErrorMsg('Informe o nome completo do responsável pela assinatura.');
      return;
    }

    if (!hasDrawn) {
      setErrorMsg('Peça para o cliente assinar no quadro com o dedo antes de salvar.');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    setSaving(true);
    try {
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem da assinatura.'))),
          'image/png'
        );
      });

      const filePath = buildOrderStoragePath(
        companyId,
        order.id,
        'client-signature',
        'png'
      );

      const { error: uploadErr } = await supabase.storage
        .from('os-signatures')
        .upload(filePath, blob, {
          contentType: 'image/png',
          upsert: false,
        });

      if (uploadErr) throw uploadErr;

      const { error: dbErr } = await supabase
        .from('service_order_signatures')
        .insert({
          company_id: companyId,
          service_order_id: order.id,
          execution_id: executionId ?? null,
          signer_type: 'client',
          signer_name: signerName.trim(),
          signer_document: signerDocument.trim() || null,
          signer_role_label: signerRole.trim() || 'Responsável no Cliente',
          storage_bucket: 'os-signatures',
          signature_file_path: filePath,
          signed_at: new Date().toISOString(),
        });

      if (dbErr) throw dbErr;

      setReplacing(false);
      await loadSignatures();
    } catch (err: unknown) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 bg-white text-xs text-slate-400">
        Carregando registro de assinatura digital...
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <PenTool className="w-4 h-4 text-teal-700" />
            Assinatura Digital do Cliente
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Coleta em tela com validade operacional armazenada no bucket privado os-signatures.
          </p>
        </div>

        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
          <Lock className="w-3 h-3 text-teal-700" />
          Arquivo Privado
        </span>
      </div>

      {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

      {/* Assinatura Já Coletada */}
      {latestClientSig && !replacing && (
        <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Assinatura Coletada com Sucesso
            </div>

            {!isClosed && (
              <button
                type="button"
                onClick={() => {
                  setSignerName(latestClientSig.signer_name);
                  setSignerDocument(latestClientSig.signer_document ?? '');
                  setReplacing(true);
                }}
                className="text-[11px] font-semibold text-teal-700 hover:underline"
              >
                Coletar nova assinatura
              </button>
            )}
          </div>

          <div className="bg-white rounded-lg border border-emerald-200 p-3 flex flex-col items-center justify-center min-h-[110px]">
            {signedImageUrl ? (
              <img
                src={signedImageUrl}
                alt={`Assinatura de ${latestClientSig.signer_name}`}
                className="max-h-28 object-contain"
              />
            ) : (
              <span className="text-xs text-slate-400">Carregando imagem...</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-700 pt-1">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">
                Responsável
              </span>
              <strong className="font-semibold text-slate-900">
                {latestClientSig.signer_name}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">
                Documento / Cargo
              </span>
              <span>
                {latestClientSig.signer_document || 'Não informado'}
                {latestClientSig.signer_role_label
                  ? ` (${latestClientSig.signer_role_label})`
                  : ''}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">
                Data / Hora
              </span>
              <span>
                {new Date(latestClientSig.signed_at).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Coleta de Assinatura (Canvas Touch + Campos) */}
      {showCanvas && (
        <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nome Completo do Responsável no Cliente *
              </label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Ex.: Marcos Antônio Pereira"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                CPF ou RG (opcional)
              </label>
              <input
                type="text"
                value={signerDocument}
                onChange={(e) => setSignerDocument(e.target.value)}
                placeholder="Ex.: 123.456.789-00"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Cargo / Vínculo no Local
            </label>
            <input
              type="text"
              value={signerRole}
              onChange={(e) => setSignerRole(e.target.value)}
              placeholder="Ex.: Gerente de Loja, Supervisor de Produção"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-700">
                Assine com o dedo ou mouse no quadro abaixo:
              </span>
              <button
                type="button"
                onClick={handleClearCanvas}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
              >
                <RotateCcw className="w-3 h-3" />
                Limpar
              </button>
            </div>

            <div className="relative rounded-xl border-2 border-dashed border-slate-300 bg-white overflow-hidden">
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ touchAction: 'none' }}
                className="w-full h-[170px] cursor-crosshair block"
              />
              {!hasDrawn && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                  Área de Assinatura do Cliente
                </div>
              )}
              <div className="pointer-events-none absolute bottom-3 left-6 right-6 border-b border-slate-200" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {replacing && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReplacing(false)}
              >
                Cancelar
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              isLoading={saving}
              onClick={() => void handleSaveSignature()}
              leftIcon={
                saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserCheck className="w-4 h-4" />
                )
              }
              className="w-full sm:w-auto justify-center"
            >
              Salvar Assinatura do Cliente
            </Button>
          </div>
        </div>
      )}

      {!latestClientSig && isClosed && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 italic">
          Esta OS foi encerrada sem registro de assinatura digital no sistema.
        </div>
      )}
    </div>
  );
};
