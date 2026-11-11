import { z } from 'zod';

export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export function onlyDigits(val: string): string {
  return val.replace(/\D/g, '');
}

export function formatCNPJ(val: string): string {
  const d = onlyDigits(val).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatCPF(val: string): string {
  const d = onlyDigits(val).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatPhone(val: string): string {
  const d = onlyDigits(val).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCEP(val: string): string {
  const d = onlyDigits(val).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function slugifyCompanyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Informe uma cor hexadecimal válida (ex.: #0B2545).');

export const loginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres.'),
});

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Informe seu nome completo (mínimo 3 caracteres).'),
    email: z.string().trim().email('Informe um e-mail válido.'),
    password: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres.'),
    confirmPassword: z.string().min(6, 'Confirme sua senha.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas informadas não coincidem.',
    path: ['confirmPassword'],
  });

export const companySettingsSchema = z.object({
  name: z.string().trim().min(2, 'O nome fantasia da empresa é obrigatório.'),
  legal_name: z.string().trim().optional(),
  document_cnpj: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || onlyDigits(v).length === 0 || onlyDigits(v).length === 14,
      'O CNPJ deve conter 14 dígitos.'
    ),
  email: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Informe um e-mail válido.'),
  phone: z.string().trim().optional(),
  logo_url: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^https?:\/\/.+/i.test(v), 'A URL do logotipo deve iniciar com http:// ou https://.'),
  sidebar_color: hexColorSchema,
  primary_color: hexColorSchema,
  accent_color: hexColorSchema,
});

export const newTenantSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome fantasia da empresa.'),
  legal_name: z.string().trim().optional(),
  slug: z
    .string()
    .trim()
    .min(2, 'Informe um identificador (slug) válido.')
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use apenas letras minúsculas, números e hífens.'),
  document_cnpj: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || onlyDigits(v).length === 0 || onlyDigits(v).length === 14,
      'O CNPJ deve conter 14 dígitos.'
    ),
  sidebar_color: hexColorSchema,
  primary_color: hexColorSchema,
  accent_color: hexColorSchema,
});

export const clientSchema = z.object({
  name: z.string().trim().min(2, 'A razão social ou nome do cliente é obrigatório.'),
  trade_name: z.string().trim().optional(),
  document_type: z.enum(['CNPJ', 'CPF', 'OUTRO']),
  document_number: z
    .string()
    .trim()
    .optional()
    .refine((v) => {
      if (!v) return true;
      const len = onlyDigits(v).length;
      return len === 0 || len === 11 || len === 14 || v.length >= 4;
    }, 'Documento inválido.'),
  contact_name: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Informe um e-mail válido.'),
  phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const clientUnitSchema = z.object({
  unit_name: z.string().trim().min(2, 'Informe o nome da unidade (ex.: Matriz, Filial CD).'),
  street: z.string().trim().min(2, 'Informe o logradouro/endereço.'),
  street_number: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().min(2, 'Informe a cidade.'),
  state: z.string().trim().length(2, 'Selecione a UF com 2 letras.'),
  postal_code: z.string().trim().optional(),
  contact_name: z.string().trim().optional(),
  contact_phone: z.string().trim().optional(),
  is_primary: z.boolean().default(false),
});

export const equipmentSchema = z.object({
  client_id: z.string().uuid('Selecione um cliente válido.'),
  unit_id: z.string().optional(),
  equipment_type: z.string().trim().min(2, 'Informe o tipo de equipamento.'),
  brand: z.string().trim().min(1, 'Informe o fabricante / marca da balança.'),
  model: z.string().trim().min(1, 'Informe o modelo do equipamento.'),
  serial_number: z.string().trim().min(1, 'O número de série é obrigatório.'),
  asset_tag: z.string().trim().optional(),
  inmetro_number: z.string().trim().optional(),
  seal_number: z.string().trim().optional(),
  accuracy_class: z.enum(['I', 'II', 'III', 'IIII', 'N/A']),
  capacity_label: z.string().trim().optional(),
  division_label: z.string().trim().optional(),
  sector_location: z.string().trim().optional(),
  last_calibration_date: z.string().optional(),
  next_calibration_date: z.string().optional(),
  status: z.enum(['active', 'maintenance', 'inactive', 'condemned']),
  notes: z.string().trim().optional(),
});

export const technicianSchema = z.object({
  full_name: z.string().trim().min(3, 'Informe o nome completo do técnico.'),
  email: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Informe um e-mail válido.'),
  phone: z.string().trim().optional(),
  document_cpf: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || onlyDigits(v).length === 0 || onlyDigits(v).length === 11,
      'O CPF deve conter 11 dígitos.'
    ),
  registration_code: z.string().trim().optional(),
  specialtiesText: z.string().trim().optional(),
  calendar_color: hexColorSchema,
  can_view_all_company_os: z.boolean().default(false),
  is_active: z.boolean().default(true),
  notes: z.string().trim().optional(),
});

export const serviceOrderSchema = z
  .object({
    client_id: z.string().uuid('Selecione o cliente da Ordem de Serviço.'),
    unit_id: z.string().optional(),
    equipment_id: z.string().optional(),
    primary_technician_id: z.string().optional(),
    order_type: z.enum(['preventive', 'corrective', 'calibration', 'installation', 'inspection']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    title: z.string().trim().min(4, 'Informe um título resumido (mínimo 4 caracteres).'),
    reported_issue: z
      .string()
      .trim()
      .min(5, 'Descreva o defeito relatado ou escopo solicitado (mínimo 5 caracteres).'),
    internal_notes: z.string().trim().optional(),
    scheduled_start: z.string().optional(),
    scheduled_end: z.string().optional(),
    allow_company_technicians_view: z.boolean().default(false),
  })
  .refine(
    (data) => {
      if (data.scheduled_start && data.scheduled_end) {
        return new Date(data.scheduled_end) >= new Date(data.scheduled_start);
      }
      return true;
    },
    {
      message: 'O horário final do agendamento deve ser posterior ou igual ao horário inicial.',
      path: ['scheduled_end'],
    }
  );

const optionalDiscountPercentSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((val) => {
    if (val === '' || val === null || val === undefined) return null;
    const num = typeof val === 'number' ? val : Number(String(val).replace(',', '.'));
    return Number.isNaN(num) ? NaN : num;
  })
  .refine((val) => val === null || (!Number.isNaN(val) && val >= 0 && val <= 100), {
    message: 'O desconto deve estar entre 0% e 100% (ou vazio para usar o padrão da empresa).',
  });

export const companyDiscountsSchema = z.object({
  discount_cash_percent: z.coerce
    .number({ invalid_type_error: 'Informe um percentual numérico válido.' })
    .min(0, 'O desconto não pode ser negativo.')
    .max(100, 'O desconto máximo permitido é 100%.'),
  discount_term_percent: z.coerce
    .number({ invalid_type_error: 'Informe um percentual numérico válido.' })
    .min(0, 'O desconto não pode ser negativo.')
    .max(100, 'O desconto máximo permitido é 100%.'),
});

export const priceCatalogItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Informe o código do item (ex.: CAT-131 ou SRV-001).')
    .max(30, 'O código deve ter no máximo 30 caracteres.'),
  category: z.string().trim().min(2, 'Informe ou selecione a categoria.'),
  subcategory: z.string().trim().optional(),
  description: z
    .string()
    .trim()
    .min(3, 'Informe o nome / descrição do produto, peça ou serviço.'),
  condition: z.string().trim().min(2, 'Informe a condição (Nova, Conserto ou Serviço).'),
  price_cash: z.coerce
    .number({ invalid_type_error: 'Informe um valor numérico válido.' })
    .min(0, 'O preço à vista não pode ser negativo.'),
  price_term: z.coerce
    .number({ invalid_type_error: 'Informe um valor numérico válido.' })
    .min(0, 'O preço a prazo não pode ser negativo.'),
  discount_cash_percent: optionalDiscountPercentSchema,
  discount_term_percent: optionalDiscountPercentSchema,
  is_active: z.boolean().default(true),
});

export function zodErrorsToMap(error: z.ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!map[key]) {
      map[key] = issue.message;
    }
  }
  return map;
}
