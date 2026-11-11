export type AppRole = 'manager' | 'technician';
export type EffectiveRole = 'platform_admin' | 'manager' | 'technician';

export type OSStatus =
  | 'open'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type OSPriority = 'low' | 'medium' | 'high' | 'urgent';

export type OSType =
  | 'preventive'
  | 'corrective'
  | 'calibration'
  | 'installation'
  | 'inspection';

export type EquipmentStatus = 'active' | 'maintenance' | 'inactive' | 'condemned';

export interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  document_cnpj: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
  sidebar_color: string;
  primary_color: string;
  accent_color: string;
  is_active: boolean;
  settings: Record<string, unknown>;
  discount_cash_percent?: number;
  discount_term_percent?: number;
  os_counter: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  default_company_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyMembership {
  id: string;
  company_id: string;
  user_id: string;
  role: AppRole;
  is_active: boolean;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  company?: Company;
  profile?: UserProfile;
}

export interface CompanyInvitation {
  id: string;
  company_id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  technician_id: string | null;
  status: 'pending' | 'accepted' | 'revoked';
  invited_by: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  company_id: string;
  name: string;
  trade_name: string | null;
  document_type: 'CNPJ' | 'CPF' | 'OUTRO';
  document_number: string | null;
  state_registration: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  units?: ClientUnit[];
}

export interface ClientUnit {
  id: string;
  company_id: string;
  client_id: string;
  unit_name: string;
  unit_code: string | null;
  street: string;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postal_code: string | null;
  reference_point: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Equipment {
  id: string;
  company_id: string;
  client_id: string;
  unit_id: string | null;
  equipment_type: string;
  brand: string;
  model: string;
  serial_number: string;
  asset_tag: string | null;
  inmetro_number: string | null;
  seal_number: string | null;
  accuracy_class: 'I' | 'II' | 'III' | 'IIII' | 'N/A' | null;
  capacity_label: string | null;
  division_label: string | null;
  sector_location: string | null;
  last_calibration_date: string | null;
  next_calibration_date: string | null;
  status: EquipmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client?: Pick<Client, 'id' | 'name' | 'trade_name'> | null;
  unit?: Pick<ClientUnit, 'id' | 'unit_name' | 'city' | 'state'> | null;
}

export interface Technician {
  id: string;
  company_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  document_cpf: string | null;
  registration_code: string | null;
  specialties: string[];
  calendar_color: string;
  can_view_all_company_os: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceOrderAssignment {
  id: string;
  company_id: string;
  service_order_id: string;
  technician_id: string;
  assignment_role: 'lead' | 'assistant' | 'reviewer';
  is_active: boolean;
  assigned_by: string | null;
  assigned_at: string;
  notes: string | null;
  technician?: Pick<Technician, 'id' | 'full_name' | 'calendar_color' | 'phone'> | null;
}

export interface ServiceOrder {
  id: string;
  company_id: string;
  sequence_number: number;
  order_number: string;
  client_id: string;
  unit_id: string | null;
  equipment_id: string | null;
  primary_technician_id: string | null;
  order_type: OSType;
  status: OSStatus;
  priority: OSPriority;
  title: string;
  reported_issue: string;
  internal_notes: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  allow_company_technicians_view: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client?: Pick<Client, 'id' | 'name' | 'trade_name' | 'document_number' | 'phone'> | null;
  unit?: Pick<ClientUnit, 'id' | 'unit_name' | 'street' | 'street_number' | 'city' | 'state'> | null;
  equipment?: Pick<
    Equipment,
    'id' | 'brand' | 'model' | 'serial_number' | 'capacity_label' | 'asset_tag'
  > | null;
  primary_technician?: Pick<Technician, 'id' | 'full_name' | 'calendar_color' | 'phone'> | null;
  assignments?: ServiceOrderAssignment[];
}

export interface ServiceOrderHistoryItem {
  id: string;
  company_id: string;
  service_order_id: string;
  actor_user_id: string | null;
  event_type: string;
  old_status: OSStatus | null;
  new_status: OSStatus | null;
  description: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DashboardStatusCounts {
  open: number;
  scheduled: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  total: number;
}

export interface GlobalSearchResults {
  clients: Pick<Client, 'id' | 'name' | 'trade_name' | 'document_number' | 'phone'>[];
  equipments: Array<
    Pick<Equipment, 'id' | 'brand' | 'model' | 'serial_number' | 'capacity_label'> & {
      client?: { name: string } | null;
    }
  >;
  serviceOrders: Array<
    Pick<ServiceOrder, 'id' | 'order_number' | 'title' | 'status' | 'priority'> & {
      client?: { name: string } | null;
    }
  >;
}

export type PaymentModality = 'cash' | 'term';
export type OrderItemStatus = 'proposed' | 'authorized' | 'applied' | 'rejected';

export interface PriceCatalogItem {
  id: string;
  company_id: string;
  code: string;
  category: string;
  subcategory: string | null;
  description: string;
  condition: string;
  price_term: number;
  price_cash: number;
  discount_cash_percent?: number | null;
  discount_term_percent?: number | null;
  is_active: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceOrderItem {
  id: string;
  company_id: string;
  service_order_id: string;
  catalog_item_id?: string | null;
  equipment_id?: string | null;
  item_code: string;
  description: string;
  category?: string | null;
  condition: string;
  payment_modality: PaymentModality;
  quantity: number;
  base_unit_price?: number;
  discount_percent?: number;
  unit_price: number;
  discount_amount: number;
  total_price: number;
  item_status: OrderItemStatus;
  notes?: string | null;
  created_by?: string | null;
  authorized_by?: string | null;
  authorized_at?: string | null;
  applied_by?: string | null;
  applied_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceCatalogImport {
  id: string;
  company_id: string;
  file_name: string;
  total_rows: number;
  imported_count: number;
  updated_count: number;
  imported_by?: string | null;
  created_at: string;
}

export interface PriceCatalogHistoryItem {
  id: string;
  company_id: string;
  catalog_item_id: string;
  item_code: string;
  event_type: 'created' | 'price_updated' | 'updated' | 'activated' | 'deactivated';
  old_price_cash: number | null;
  new_price_cash: number | null;
  old_price_term: number | null;
  new_price_term: number | null;
  old_is_active: boolean | null;
  new_is_active: boolean | null;
  changes: Record<string, unknown>;
  changed_by: string | null;
  created_at: string;
}

export type ChecklistItemStatus = 'ok' | 'attention' | 'fail' | 'na';

export type ScaleChecklistKey =
  | 'power_and_cables'
  | 'load_cell_and_wiring'
  | 'display_and_keyboard'
  | 'leveling_and_feet'
  | 'platform_and_structure'
  | 'inmetro_seal_integrity'
  | 'zero_stability_and_tare'
  | 'linearity_and_eccentricity';

export type ScaleChecklistMap = Record<ScaleChecklistKey, ChecklistItemStatus>;

export type SignatureOmittedReason = 'client_absent' | 'client_refused' | 'other';

export interface ScaleExecutionMetadata {
  travel_started_at?: string | null;
  travel_latitude?: number | null;
  travel_longitude?: number | null;
  arrived_at?: string | null;
  checkin_accuracy_meters?: number | null;
  gps_fallback_reason?: string | null;
  checklist: ScaleChecklistMap;
  checklist_notes?: string;
  signature_omitted_reason?: SignatureOmittedReason | null;
  signature_omitted_notes?: string | null;
}

export interface ServiceOrderExecution {
  id: string;
  company_id: string;
  service_order_id: string;
  technician_id: string;
  started_at: string;
  finished_at: string | null;
  checkin_latitude: number | null;
  checkin_longitude: number | null;
  diagnosis: string | null;
  performed_services: string | null;
  parts_replaced: unknown[];
  calibration_measurements: ScaleExecutionMetadata | Record<string, unknown>;
  removed_seal_number: string | null;
  applied_seal_number: string | null;
  equipment_approved: boolean | null;
  created_at: string;
  updated_at: string;
}

export type AttachmentType =
  | 'photo_before'
  | 'photo_after'
  | 'seal_photo'
  | 'certificate'
  | 'document'
  | 'photo';

export interface ServiceOrderAttachment {
  id: string;
  company_id: string;
  service_order_id: string;
  execution_id?: string | null;
  uploaded_by?: string | null;
  attachment_type: AttachmentType;
  storage_bucket: string;
  file_path: string;
  file_name: string;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  description?: string | null;
  created_at: string;
}

export interface ServiceOrderSignature {
  id: string;
  company_id: string;
  service_order_id: string;
  execution_id?: string | null;
  signer_type: 'client' | 'technician';
  signer_name: string;
  signer_document?: string | null;
  signer_role_label?: string | null;
  storage_bucket: string;
  signature_file_path: string;
  signed_at: string;
  metadata?: Record<string, unknown>;
}
