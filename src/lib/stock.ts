import { supabase } from './supabase';
import type {
  StockLocation,
  InventoryItem,
  StockMovement,
  StockAlert,
} from '../types/database';

export async function fetchStockLocations(companyId: string): Promise<StockLocation[]> {
  const { data, error } = await supabase
    .from('stock_locations')
    .select(`
      *,
      technician:technicians(id, full_name, phone)
    `)
    .eq('company_id', companyId)
    .order('location_type', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []) as unknown as StockLocation[];
}

export async function fetchInventoryItems(
  companyId: string,
  locationId?: string
): Promise<InventoryItem[]> {
  let query = supabase
    .from('inventory_items')
    .select(`
      *,
      location:stock_locations(id, name, location_type)
    `)
    .eq('company_id', companyId)
    .order('name', { ascending: true });

  if (locationId && locationId !== 'all') {
    query = query.eq('location_id', locationId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as InventoryItem[];
}

export async function fetchStockMovements(
  companyId: string,
  limit = 50
): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select(`
      *,
      source_location:stock_locations!fk_stock_movements_source(id, name),
      destination_location:stock_locations!fk_stock_movements_dest(id, name)
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    // Fallback gracioso sem joins caso a chave não esteja explicitada no PostgREST
    const fallback = await supabase
      .from('stock_movements')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (fallback.error) throw fallback.error;
    return (fallback.data || []) as StockMovement[];
  }

  return (data || []) as unknown as StockMovement[];
}

export async function fetchLowStockAlerts(companyId: string): Promise<StockAlert[]> {
  const { data, error } = await supabase.rpc('get_low_stock_alerts', {
    p_company_id: companyId,
  });

  if (error) {
    // Fallback: consulta direta em inventory_items onde quantity <= min_quantity
    const { data: directData, error: directErr } = await supabase
      .from('inventory_items')
      .select(`
        id,
        item_code,
        name,
        location_id,
        location:stock_locations(name, location_type),
        quantity,
        min_quantity,
        unit_cost
      `)
      .eq('company_id', companyId);

    if (directErr) throw directErr;
    return (directData || [])
      .filter((i: any) => Number(i.quantity) <= Number(i.min_quantity))
      .map((i: any) => ({
        item_id: i.id,
        item_code: i.item_code,
        item_name: i.name,
        location_id: i.location_id,
        location_name: i.location?.name || 'Local',
        location_type: i.location?.location_type || 'warehouse',
        current_quantity: Number(i.quantity),
        min_quantity: Number(i.min_quantity),
        unit_cost: Number(i.unit_cost),
      }));
  }

  return (data || []) as StockAlert[];
}

export interface StockEntryPayload {
  locationId: string;
  catalogItemId?: string | null;
  itemCode: string;
  name: string;
  category?: string;
  quantity: number;
  unitCost: number;
  invoiceNumber?: string;
  notes?: string;
}

export async function createStockEntry(
  companyId: string,
  payload: StockEntryPayload
): Promise<string> {
  const { data, error } = await supabase.rpc('process_stock_entry', {
    p_company_id: companyId,
    p_location_id: payload.locationId,
    p_catalog_item_id: payload.catalogItemId || null,
    p_item_code: payload.itemCode.trim(),
    p_name: payload.name.trim(),
    p_category: payload.category || null,
    p_quantity: payload.quantity,
    p_unit_cost: payload.unitCost,
    p_invoice_number: payload.invoiceNumber?.trim() || null,
    p_notes: payload.notes?.trim() || null,
  });

  if (error) throw error;
  return data as string;
}

export interface StockTransferPayload {
  sourceLocationId: string;
  destLocationId: string;
  itemCode: string;
  quantity: number;
  notes?: string;
}

export async function transferStock(
  companyId: string,
  payload: StockTransferPayload
): Promise<boolean> {
  const { data, error } = await supabase.rpc('process_stock_transfer', {
    p_company_id: companyId,
    p_source_location_id: payload.sourceLocationId,
    p_dest_location_id: payload.destLocationId,
    p_item_code: payload.itemCode.trim(),
    p_quantity: payload.quantity,
    p_notes: payload.notes?.trim() || null,
  });

  if (error) throw error;
  return Boolean(data);
}
