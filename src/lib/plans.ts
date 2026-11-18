import { supabase } from './supabase';
import type {
  Plan,
  Subscription,
  CompanyPlanOverride,
  CompanyEffectivePlan,
  PlanFeatures,
  PlanLimits,
  BillingCycle,
  SubscriptionStatus,
} from '../types/database';

export interface PlanPayload {
  name: string;
  slug: string;
  description?: string;
  price: number;
  billing_cycle: BillingCycle;
  trial_days: number;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  max_technicians?: number | null;
  max_users?: number | null;
  max_clients?: number | null;
  max_equipments?: number | null;
  max_storage_mb?: number | null;
  max_monthly_os?: number | null;
  features: PlanFeatures;
}

export async function fetchPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data || []) as Plan[];
}

export async function createPlan(payload: PlanPayload): Promise<Plan> {
  const { data, error } = await supabase
    .from('plans')
    .insert({
      name: payload.name.trim(),
      slug: payload.slug.trim().toLowerCase(),
      description: payload.description?.trim() || null,
      price: payload.price,
      billing_cycle: payload.billing_cycle,
      trial_days: payload.trial_days,
      is_active: payload.is_active,
      is_public: payload.is_public,
      sort_order: payload.sort_order,
      max_technicians: payload.max_technicians ?? null,
      max_users: payload.max_users ?? null,
      max_clients: payload.max_clients ?? null,
      max_equipments: payload.max_equipments ?? null,
      max_storage_mb: payload.max_storage_mb ?? null,
      max_monthly_os: payload.max_monthly_os ?? null,
      features: payload.features,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as Plan;
}

export async function updatePlan(id: string, payload: Partial<PlanPayload>): Promise<Plan> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (payload.name !== undefined) updates.name = payload.name.trim();
  if (payload.slug !== undefined) updates.slug = payload.slug.trim().toLowerCase();
  if (payload.description !== undefined) updates.description = payload.description?.trim() || null;
  if (payload.price !== undefined) updates.price = payload.price;
  if (payload.billing_cycle !== undefined) updates.billing_cycle = payload.billing_cycle;
  if (payload.trial_days !== undefined) updates.trial_days = payload.trial_days;
  if (payload.is_active !== undefined) updates.is_active = payload.is_active;
  if (payload.is_public !== undefined) updates.is_public = payload.is_public;
  if (payload.sort_order !== undefined) updates.sort_order = payload.sort_order;
  if (payload.max_technicians !== undefined) updates.max_technicians = payload.max_technicians;
  if (payload.max_users !== undefined) updates.max_users = payload.max_users;
  if (payload.max_clients !== undefined) updates.max_clients = payload.max_clients;
  if (payload.max_equipments !== undefined) updates.max_equipments = payload.max_equipments;
  if (payload.max_storage_mb !== undefined) updates.max_storage_mb = payload.max_storage_mb;
  if (payload.max_monthly_os !== undefined) updates.max_monthly_os = payload.max_monthly_os;
  if (payload.features !== undefined) updates.features = payload.features;

  const { data, error } = await supabase
    .from('plans')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as Plan;
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase.from('plans').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchAllSubscriptions(): Promise<(Subscription & { company_name?: string })[]> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, plans(*), companies(name, slug)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    ...row,
    plan: row.plans,
    company_name: row.companies?.name,
  })) as (Subscription & { company_name?: string })[];
}

export async function fetchCompanySubscription(companyId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, plans(*)')
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    plan: (data as any).plans,
  } as Subscription;
}

export async function updateCompanySubscription(
  companyId: string,
  planId: string,
  status: SubscriptionStatus = 'active',
  notes?: string
): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .upsert({
      company_id: companyId,
      plan_id: planId,
      status,
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    .select('*, plans(*)')
    .single();

  if (error) throw error;
  return {
    ...data,
    plan: (data as any).plans,
  } as Subscription;
}

export async function fetchCompanyOverride(companyId: string): Promise<CompanyPlanOverride | null> {
  const { data, error } = await supabase
    .from('company_plan_overrides')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) throw error;
  return data as CompanyPlanOverride | null;
}

export async function saveCompanyOverride(
  companyId: string,
  overrideLimits: Partial<PlanLimits>,
  overrideFeatures: Partial<PlanFeatures>,
  reason: string
): Promise<CompanyPlanOverride> {
  const { data, error } = await supabase
    .from('company_plan_overrides')
    .upsert({
      company_id: companyId,
      override_limits: overrideLimits,
      override_features: overrideFeatures,
      reason: reason.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data as CompanyPlanOverride;
}

export async function removeCompanyOverride(companyId: string): Promise<void> {
  const { error } = await supabase
    .from('company_plan_overrides')
    .delete()
    .eq('company_id', companyId);

  if (error) throw error;
}

export async function fetchCompanyEffectivePlan(companyId: string): Promise<CompanyEffectivePlan | null> {
  const { data, error } = await supabase.rpc('get_company_effective_plan', {
    p_company_id: companyId,
  });

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const row = data[0];
  return {
    company_id: row.company_id,
    plan_id: row.plan_id,
    plan_name: row.plan_name,
    plan_slug: row.plan_slug,
    subscription_status: row.subscription_status as SubscriptionStatus,
    billing_cycle: row.billing_cycle as BillingCycle,
    trial_ends_at: row.trial_ends_at,
    is_customized: row.is_customized,
    effective_limits: row.effective_limits as PlanLimits,
    effective_features: row.effective_features as PlanFeatures,
  };
}
