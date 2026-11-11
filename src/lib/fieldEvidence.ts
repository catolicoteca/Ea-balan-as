import { getChecklistProgress, parseExecutionMetadata } from './fieldExecution';
import type {
  AttachmentType,
  ServiceOrderAttachment,
  ServiceOrderExecution,
  ServiceOrderItem,
  ServiceOrderSignature,
  SignatureOmittedReason,
} from '../types/database';

export const SIGNATURE_OMITTED_REASONS: Record<SignatureOmittedReason, string> = {
  client_absent: 'Cliente / responsável ausente no local',
  client_refused: 'Responsável recusou assinar',
  other: 'Responsável indisponível / Outro motivo',
};

export const PHOTO_CATEGORIES: Array<{
  type: AttachmentType;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    type: 'photo_before',
    label: 'Antes do Serviço',
    shortLabel: 'Antes',
    description: 'Estado inicial da balança, defeito visível ou local de instalação.',
  },
  {
    type: 'photo_after',
    label: 'Depois do Serviço',
    shortLabel: 'Depois',
    description: 'Equipamento limpo, calibrado e funcionando após a intervenção.',
  },
  {
    type: 'seal_photo',
    label: 'Fotos dos Lacres',
    shortLabel: 'Lacres',
    description: 'Foto legível do lacre anterior rompido e do novo lacre INMETRO aplicado.',
  },
];

export function getAttachmentTypeLabel(type: AttachmentType): string {
  const found = PHOTO_CATEGORIES.find((c) => c.type === type);
  if (found) return found.label;
  if (type === 'certificate') return 'Certificado';
  if (type === 'document') return 'Documento';
  return 'Foto Geral';
}

/**
 * Constrói obrigatoriamente o caminho esperado pela policy RLS de Storage:
 * {company_id}/{service_order_id}/{categoria}-{timestamp}-{random}.{ext}
 */
export function buildOrderStoragePath(
  companyId: string,
  serviceOrderId: string,
  prefix: string,
  extension: string
): string {
  const cleanExt = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${companyId}/${serviceOrderId}/${prefix}-${Date.now()}-${rand}.${cleanExt}`;
}

/**
 * Redimensiona e comprime imagens pesadas de câmera de celular no navegador antes do upload.
 */
export async function compressImageForUpload(
  file: File,
  maxDimension = 1440,
  quality = 0.82
): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    const ext = file.name.split('.').pop() || 'bin';
    return { blob: file, mimeType: file.type || 'application/octet-stream', extension: ext };
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve({ blob: file, mimeType: file.type, extension: 'jpg' });
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve({ blob: file, mimeType: file.type, extension: 'jpg' });
            return;
          }
          resolve({ blob, mimeType: 'image/jpeg', extension: 'jpg' });
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ blob: file, mimeType: file.type || 'image/jpeg', extension: 'jpg' });
    };

    img.src = url;
  });
}

export interface ClosureValidationInput {
  execution: ServiceOrderExecution | null;
  signatures: ServiceOrderSignature[];
  attachments: ServiceOrderAttachment[];
  items?: ServiceOrderItem[];
  signatureOmission?: {
    enabled: boolean;
    reason: SignatureOmittedReason | '';
    notes: string;
  };
}

export interface ClosureValidationResult {
  valid: boolean;
  missingFields: string[];
  warnings: string[];
}

/**
 * Valida obrigatoriedades técnicas e comerciais antes do fechamento (status = completed) da OS.
 * A assinatura digital do cliente é o caminho padrão; quando não houver assinatura, aceita
 * fechamento mediante justificativa formal obrigatória (ex.: cliente ausente ou recusa).
 */
export function validateServiceOrderClosure(
  input: ClosureValidationInput
): ClosureValidationResult {
  const missingFields: string[] = [];
  const warnings: string[] = [];

  if (!input.execution) {
    missingFields.push('Iniciar o atendimento em campo (deslocamento ou check-in).');
  } else {
    const diag = (input.execution.diagnosis ?? '').trim();
    if (diag.length < 5) {
      missingFields.push('Preencher o diagnóstico técnico (mínimo 5 caracteres).');
    }

    const meta = parseExecutionMetadata(input.execution.calibration_measurements);
    const prog = getChecklistProgress(meta.checklist);
    if (!prog.isComplete) {
      missingFields.push(
        `Concluir o checklist metrológico (${prog.answered}/${prog.total} itens respondidos).`
      );
    }

    if (input.execution.equipment_approved === null) {
      missingFields.push('Selecionar o parecer técnico final (Aprovada ou Reprovada).');
    }
  }

  const hasClientSignature = input.signatures.some((s) => s.signer_type === 'client');
  const metaOmitted = input.execution
    ? parseExecutionMetadata(input.execution.calibration_measurements)
    : null;
  const hasSavedOmission = Boolean(
    metaOmitted?.signature_omitted_reason &&
      (metaOmitted.signature_omitted_notes ?? '').trim().length >= 5
  );
  const hasPendingOmission = Boolean(
    input.signatureOmission?.enabled &&
      input.signatureOmission.reason &&
      input.signatureOmission.notes.trim().length >= 5
  );

  if (!hasClientSignature && !hasSavedOmission && !hasPendingOmission) {
    if (input.signatureOmission?.enabled) {
      missingFields.push(
        'Informar o motivo e descrever a justificativa (mín. 5 caracteres) para concluir sem assinatura.'
      );
    } else {
      missingFields.push(
        'Coletar a assinatura digital do responsável no cliente (ou registrar justificativa).'
      );
    }
  }

  if (!hasClientSignature && (hasPendingOmission || hasSavedOmission)) {
    warnings.push(
      'OS será encerrada sem assinatura digital mediante justificativa auditada.'
    );
  }

  if (input.attachments.length === 0) {
    warnings.push('Nenhuma foto de evidência (antes/depois/lacre) foi anexada.');
  }

  const pendingAuthorizedItems = (input.items ?? []).filter(
    (item) => item.item_status === 'authorized'
  );
  if (pendingAuthorizedItems.length > 0) {
    warnings.push(
      `Há ${pendingAuthorizedItems.length} peça(s) autorizada(s) pelo gestor ainda marcada(s) como não aplicada(s).`
    );
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
    warnings,
  };
}
