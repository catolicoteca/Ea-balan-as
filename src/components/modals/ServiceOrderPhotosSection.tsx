import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Image as ImageIcon,
  Trash2,
  Maximize2,
  X,
  Loader2,
  Lock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import { translateSupabaseError } from '../../lib/errors';
import {
  buildOrderStoragePath,
  compressImageForUpload,
  getAttachmentTypeLabel,
  PHOTO_CATEGORIES,
} from '../../lib/fieldEvidence';
import type {
  AttachmentType,
  ServiceOrder,
  ServiceOrderAttachment,
} from '../../types/database';
import { AlertBanner } from '../ui/EmptyState';

interface ServiceOrderPhotosSectionProps {
  order: ServiceOrder;
  companyId: string;
  executionId?: string | null;
  onAttachmentsChanged?: (attachments: ServiceOrderAttachment[]) => void;
}

export const ServiceOrderPhotosSection: React.FC<ServiceOrderPhotosSectionProps> = ({
  order,
  companyId,
  executionId,
  onAttachmentsChanged,
}) => {
  const { user, permissions } = useAuthTenant();

  const [selectedCategory, setSelectedCategory] =
    useState<AttachmentType>('photo_before');
  const [attachments, setAttachments] = useState<ServiceOrderAttachment[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{
    url: string;
    label: string;
    fileName: string;
  } | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const isClosed = order.status === 'completed' || order.status === 'cancelled';
  const canUpload = !isClosed;
  // Conforme RLS attachments_delete_policy no banco, apenas Gestor/Admin pode excluir registros
  const canDelete = permissions.canManageCompanySettings;

  const loadAttachments = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    const { data, error } = await supabase
      .from('service_order_attachments')
      .select('*')
      .eq('company_id', companyId)
      .eq('service_order_id', order.id)
      .order('created_at', { ascending: false });

    if (error) {
      setErrorMsg(translateSupabaseError(error));
      setLoading(false);
      return;
    }

    const list = (data as ServiceOrderAttachment[]) ?? [];
    setAttachments(list);
    onAttachmentsChanged?.(list);

    // Gera URLs assinadas temporárias no bucket privado os-attachments
    if (list.length > 0) {
      const paths = list.map((a) => a.file_path);
      const { data: signedData } = await supabase.storage
        .from('os-attachments')
        .createSignedUrls(paths, 3600);

      if (signedData) {
        const urlMap: Record<string, string> = {};
        for (const item of signedData) {
          if (item.path && item.signedUrl) {
            urlMap[item.path] = item.signedUrl;
          }
        }
        setSignedUrls(urlMap);
      }
    } else {
      setSignedUrls({});
    }

    setLoading(false);
  }, [companyId, onAttachmentsChanged, order.id]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0 || !canUpload) return;

    setUploading(true);
    setErrorMsg(null);

    try {
      for (const file of Array.from(files)) {
        const compressed = await compressImageForUpload(file);
        const path = buildOrderStoragePath(
          companyId,
          order.id,
          selectedCategory,
          compressed.extension
        );

        const { error: uploadErr } = await supabase.storage
          .from('os-attachments')
          .upload(path, compressed.blob, {
            contentType: compressed.mimeType,
            upsert: false,
          });

        if (uploadErr) {
          throw uploadErr;
        }

        const { error: dbErr } = await supabase
          .from('service_order_attachments')
          .insert({
            company_id: companyId,
            service_order_id: order.id,
            execution_id: executionId ?? null,
            uploaded_by: user?.id ?? null,
            attachment_type: selectedCategory,
            storage_bucket: 'os-attachments',
            file_path: path,
            file_name: file.name || `${selectedCategory}.${compressed.extension}`,
            mime_type: compressed.mimeType,
            file_size_bytes: compressed.blob.size,
            description: getAttachmentTypeLabel(selectedCategory),
          });

        if (dbErr) {
          throw dbErr;
        }
      }

      await loadAttachments();
    } catch (err: unknown) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleDeleteAttachment = async (att: ServiceOrderAttachment) => {
    if (!canDelete) return;
    if (!window.confirm('Remover esta foto da Ordem de Serviço?')) return;

    setDeletingId(att.id);
    setErrorMsg(null);

    try {
      const { error: dbErr } = await supabase
        .from('service_order_attachments')
        .delete()
        .eq('id', att.id)
        .eq('company_id', companyId);

      if (dbErr) throw dbErr;

      // Remove o arquivo físico do bucket privado se existir
      await supabase.storage.from('os-attachments').remove([att.file_path]);

      await loadAttachments();
    } catch (err: unknown) {
      setErrorMsg(translateSupabaseError(err));
    } finally {
      setDeletingId(null);
    }
  };

  const currentCategoryInfo = PHOTO_CATEGORIES.find(
    (c) => c.type === selectedCategory
  );

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-teal-700" />
            Fotos do Atendimento ({attachments.length})
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Armazenamento privado isolado por empresa e OS (antes, depois e lacres).
          </p>
        </div>

        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
          <Lock className="w-3 h-3 text-teal-700" />
          Bucket Privado
        </span>
      </div>

      {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

      {/* Seletor de Categoria + Inputs de Câmera e Galeria */}
      {canUpload && (
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            {PHOTO_CATEGORIES.map((cat) => {
              const count = attachments.filter(
                (a) => a.attachment_type === cat.type
              ).length;
              const isSelected = selectedCategory === cat.type;
              return (
                <button
                  key={cat.type}
                  type="button"
                  onClick={() => setSelectedCategory(cat.type)}
                  className={`py-2 px-2 rounded-lg text-[11px] font-semibold border transition-all text-center ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {cat.shortLabel}{' '}
                  <span
                    className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {currentCategoryInfo && (
            <p className="text-[11px] text-slate-500">
              {currentCategoryInfo.description}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Botão Câmera Direta (Mobile) */}
            <label
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors ${
                uploading ? 'opacity-60 pointer-events-none' : ''
              }`}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              <span>Tirar Foto ({currentCategoryInfo?.shortLabel})</span>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploading}
                onChange={(e) => void handleFilesSelected(e.target.files)}
                className="hidden"
              />
            </label>

            {/* Botão Galeria (Múltiplas Fotos) */}
            <label
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold border border-slate-300 cursor-pointer transition-colors ${
                uploading ? 'opacity-60 pointer-events-none' : ''
              }`}
            >
              <ImageIcon className="w-4 h-4 text-slate-600" />
              <span>Escolher da Galeria</span>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                disabled={uploading}
                onChange={(e) => void handleFilesSelected(e.target.files)}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {/* Galeria de Miniaturas */}
      {loading ? (
        <div className="py-6 text-center text-xs text-slate-400">
          Carregando fotos seguras...
        </div>
      ) : attachments.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
          Nenhuma foto anexada a esta OS até o momento.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {attachments.map((att) => {
            const url = signedUrls[att.file_path];
            const label = getAttachmentTypeLabel(att.attachment_type);

            return (
              <div
                key={att.id}
                className="group relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex flex-col"
              >
                <div
                  className="aspect-square bg-slate-100 relative overflow-hidden cursor-pointer"
                  onClick={() =>
                    url &&
                    setLightboxPhoto({
                      url,
                      label,
                      fileName: att.file_name,
                    })
                  }
                >
                  {url ? (
                    <img
                      src={url}
                      alt={label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-[10px]">
                      Carregando...
                    </div>
                  )}

                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-900/75 text-white text-[10px] font-semibold">
                    {label}
                  </span>

                  {url && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxPhoto({
                          url,
                          label,
                          fileName: att.file_name,
                        });
                      }}
                      className="absolute bottom-1.5 right-1.5 p-1.5 rounded-lg bg-slate-900/70 text-white hover:bg-slate-900"
                      title="Ampliar foto"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="p-2 flex items-center justify-between gap-1 text-[10px] text-slate-500 bg-white">
                  <span className="truncate">
                    {new Date(att.created_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>

                  {canDelete && (
                    <button
                      type="button"
                      disabled={deletingId === att.id}
                      onClick={() => void handleDeleteAttachment(att)}
                      className="p-1 rounded text-red-600 hover:bg-red-50 transition-colors"
                      title="Remover foto"
                    >
                      {deletingId === att.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox para Visualização Ampliada */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="w-full max-w-3xl flex items-center justify-between text-white mb-3">
            <div>
              <div className="text-sm font-bold">{lightboxPhoto.label}</div>
              <div className="text-[11px] text-slate-400">
                {lightboxPhoto.fileName}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLightboxPhoto(null)}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <img
            src={lightboxPhoto.url}
            alt={lightboxPhoto.label}
            className="max-h-[80vh] max-w-full rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
