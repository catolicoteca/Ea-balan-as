import type {
  ChecklistItemStatus,
  ScaleChecklistKey,
  ScaleExecutionMetadata,
  SignatureOmittedReason,
} from '../types/database';

export interface ScaleChecklistItemDefinition {
  key: ScaleChecklistKey;
  label: string;
  description: string;
}

export const SCALE_CHECKLIST_ITEMS: ScaleChecklistItemDefinition[] = [
  {
    key: 'power_and_cables',
    label: 'Alimentação elétrica, fonte e cabos',
    description: 'Cabo de força, fonte de alimentação, bateria interna e conectores.',
  },
  {
    key: 'load_cell_and_wiring',
    label: 'Célula(s) de carga e caixa de junção',
    description: 'Estado físico da célula, blindagem, soldas e isolamento contra umidade.',
  },
  {
    key: 'display_and_keyboard',
    label: 'Visor / display e teclado de membrana',
    description: 'Segmentos nítidos, iluminação, botões de tara, zero e impressão.',
  },
  {
    key: 'leveling_and_feet',
    label: 'Nivelamento (nível bolha) e pés reguláveis',
    description: 'Balança firme na bancada/piso e bolha centralizada.',
  },
  {
    key: 'platform_and_structure',
    label: 'Prato de pesagem, batentes e estrutura',
    description: 'Folga mecânica, batentes de sobrecarga e limpeza sob o prato.',
  },
  {
    key: 'inmetro_seal_integrity',
    label: 'Lacre e selo INMETRO / IPEM',
    description: 'Verificação da integridade do lacre anterior e marcações obrigatórias.',
  },
  {
    key: 'zero_stability_and_tare',
    label: 'Estabilidade de zero e função Tara',
    description: 'Retorno ao zero sem deriva após aplicação/remoção de carga.',
  },
  {
    key: 'linearity_and_eccentricity',
    label: 'Repetibilidade e excentricidade (cantos)',
    description: 'Consistência de leitura com pesos padrão no centro e nas extremidades.',
  },
];

export const CHECKLIST_STATUS_LABELS: Record<ChecklistItemStatus, string> = {
  ok: 'OK',
  attention: 'Atenção',
  fail: 'Defeito',
  na: 'N/A',
};

export interface ParsedScaleExecutionMetadata {
  travel_started_at: string | null;
  travel_latitude: number | null;
  travel_longitude: number | null;
  arrived_at: string | null;
  checkin_accuracy_meters: number | null;
  gps_fallback_reason: string | null;
  checklist: Partial<Record<ScaleChecklistKey, ChecklistItemStatus>>;
  checklist_notes: string;
  signature_omitted_reason?: SignatureOmittedReason | null;
  signature_omitted_notes?: string | null;
}

export function parseExecutionMetadata(raw: unknown): ParsedScaleExecutionMetadata {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawChecklist =
    obj.checklist && typeof obj.checklist === 'object'
      ? (obj.checklist as Record<string, unknown>)
      : {};

  const cleanChecklist: Partial<Record<ScaleChecklistKey, ChecklistItemStatus>> = {};
  for (const item of SCALE_CHECKLIST_ITEMS) {
    const val = rawChecklist[item.key];
    if (val === 'ok' || val === 'attention' || val === 'fail' || val === 'na') {
      cleanChecklist[item.key] = val;
    }
  }

  const rawOmitted = obj.signature_omitted_reason;
  const signatureOmittedReason: SignatureOmittedReason | null =
    rawOmitted === 'client_absent' ||
    rawOmitted === 'client_refused' ||
    rawOmitted === 'other'
      ? rawOmitted
      : null;

  return {
    travel_started_at: typeof obj.travel_started_at === 'string' ? obj.travel_started_at : null,
    travel_latitude: typeof obj.travel_latitude === 'number' ? obj.travel_latitude : null,
    travel_longitude: typeof obj.travel_longitude === 'number' ? obj.travel_longitude : null,
    arrived_at: typeof obj.arrived_at === 'string' ? obj.arrived_at : null,
    checkin_accuracy_meters:
      typeof obj.checkin_accuracy_meters === 'number' ? obj.checkin_accuracy_meters : null,
    gps_fallback_reason:
      typeof obj.gps_fallback_reason === 'string' ? obj.gps_fallback_reason : null,
    checklist: cleanChecklist,
    checklist_notes: typeof obj.checklist_notes === 'string' ? obj.checklist_notes : '',
    signature_omitted_reason: signatureOmittedReason,
    signature_omitted_notes:
      typeof obj.signature_omitted_notes === 'string' ? obj.signature_omitted_notes : null,
  };
}

export function serializeExecutionMetadata(
  meta: ParsedScaleExecutionMetadata
): ScaleExecutionMetadata {
  return {
    travel_started_at: meta.travel_started_at,
    travel_latitude: meta.travel_latitude,
    travel_longitude: meta.travel_longitude,
    arrived_at: meta.arrived_at,
    checkin_accuracy_meters: meta.checkin_accuracy_meters,
    gps_fallback_reason: meta.gps_fallback_reason,
    checklist: meta.checklist as ScaleExecutionMetadata['checklist'],
    checklist_notes: meta.checklist_notes,
    signature_omitted_reason: meta.signature_omitted_reason,
    signature_omitted_notes: meta.signature_omitted_notes,
  };
}

export function getChecklistProgress(
  checklist: Partial<Record<ScaleChecklistKey, ChecklistItemStatus>>
) {
  const total = SCALE_CHECKLIST_ITEMS.length;
  let answered = 0;
  let issuesCount = 0;

  for (const item of SCALE_CHECKLIST_ITEMS) {
    const status = checklist[item.key];
    if (status) {
      answered += 1;
      if (status === 'attention' || status === 'fail') {
        issuesCount += 1;
      }
    }
  }

  return {
    answered,
    total,
    issuesCount,
    isComplete: answered === total,
    percentage: Math.round((answered / total) * 100),
  };
}

export function getGoogleMapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export interface GpsCaptureResult {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  errorReason?: string;
}

export function captureCurrentCoordinates(): Promise<GpsCaptureResult> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({
        ok: false,
        errorReason: 'Geolocalização não suportada neste navegador/dispositivo.',
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          ok: true,
          latitude: Number(position.coords.latitude.toFixed(7)),
          longitude: Number(position.coords.longitude.toFixed(7)),
          accuracy: Math.round(position.coords.accuracy),
        });
      },
      (err) => {
        let errorReason = 'Não foi possível obter a localização GPS.';
        if (err.code === 1) {
          errorReason = 'Permissão de localização negada pelo usuário no dispositivo.';
        } else if (err.code === 2) {
          errorReason = 'Sinal de localização indisponível no momento.';
        } else if (err.code === 3) {
          errorReason = 'Tempo limite excedido ao tentar capturar GPS.';
        }
        resolve({ ok: false, errorReason });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      }
    );
  });
}
