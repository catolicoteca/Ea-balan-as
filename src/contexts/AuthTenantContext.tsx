import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigStatus } from '../lib/supabase';
import { isSchemaMissingError, translateSupabaseError } from '../lib/errors';
import { getPermissionsForRole, type RolePermissions } from '../lib/permissions';
import type {
  Company,
  CompanyMembership,
  EffectiveRole,
  Technician,
  UserProfile,
} from '../types/database';

interface AuthTenantContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  schemaMissing: boolean;
  isPlatformAdmin: boolean;
  isPlatformSetupNeeded: boolean;
  companies: Company[];
  memberships: CompanyMembership[];
  activeCompany: Company | null;
  effectiveRole: EffectiveRole | null;
  permissions: RolePermissions;
  myTechnician: Technician | null;
  authError: string | null;
  selectCompany: (companyId: string) => void;
  refreshTenantContext: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthTenantContext = createContext<AuthTenantContextValue | undefined>(undefined);

const ACTIVE_COMPANY_STORAGE_KEY = 'ea_balancas_active_company_id';

export const DEFAULT_BRAND_COLORS = {
  sidebar_color: '#0B2545',
  primary_color: '#0D9488',
  accent_color: '#14B8A6',
};

function applyBrandVariables(company: Company | null) {
  const root = document.documentElement;
  const sidebar = company?.sidebar_color || DEFAULT_BRAND_COLORS.sidebar_color;
  const primary = company?.primary_color || DEFAULT_BRAND_COLORS.primary_color;
  const accent = company?.accent_color || DEFAULT_BRAND_COLORS.accent_color;

  root.style.setProperty('--brand-sidebar', sidebar);
  root.style.setProperty('--brand-primary', primary);
  root.style.setProperty('--brand-accent', accent);
  document.title = company
    ? `${company.name} — Metrion Assistência Técnica`
    : 'Metrion — Plataforma SaaS de Assistência Técnica';
}

export const AuthTenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [schemaMissing, setSchemaMissing] = useState<boolean>(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean>(false);
  const [isPlatformSetupNeeded, setIsPlatformSetupNeeded] = useState<boolean>(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [myTechnician, setMyTechnician] = useState<Technician | null>(null);
  const [authError, setAuthError] = useState<string | null>(
    supabaseConfigStatus.valid ? null : supabaseConfigStatus.reason ?? null
  );

  const loadUserAndTenantData = useCallback(async (currentSession: Session | null) => {
    if (!supabaseConfigStatus.valid) {
      setIsLoading(false);
      return;
    }

    if (!currentSession?.user) {
      // Mesmo deslogado, faz um teste rápido de leitura pública para saber se o schema existe (PGRST205 vs RLS 0 rows)
      const probe = await supabase.from('companies').select('id').limit(1);
      setSchemaMissing(Boolean(probe.error && isSchemaMissingError(probe.error)));
      setProfile(null);
      setIsPlatformAdmin(false);
      setIsPlatformSetupNeeded(false);
      setCompanies([]);
      setMemberships([]);
      setMyTechnician(null);
      applyBrandVariables(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setAuthError(null);

    const uid = currentSession.user.id;

    try {
      // Tenta vincular convites pendentes válidos e com e-mail confirmado
      let claimRes = await supabase.rpc('claim_pending_invitations');
      if (claimRes.error && claimRes.error.code === 'PGRST202') {
        claimRes = await supabase.rpc('claim_my_invitations');
      }
      if (claimRes.error && isSchemaMissingError(claimRes.error)) {
        setSchemaMissing(true);
        setIsLoading(false);
        return;
      }

      const [profileRes, adminRes, membershipsRes, companiesRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
        supabase
          .from('platform_admins')
          .select('user_id, is_active')
          .eq('user_id', uid)
          .eq('is_active', true)
          .maybeSingle(),
        supabase
          .from('company_memberships')
          .select('*')
          .eq('user_id', uid)
          .eq('is_active', true),
        supabase.from('companies').select('*').order('name', { ascending: true }),
      ]);

      const firstSchemaErr = [
        profileRes.error,
        adminRes.error,
        membershipsRes.error,
        companiesRes.error,
      ].find((err) => err && isSchemaMissingError(err));

      if (firstSchemaErr) {
        setSchemaMissing(true);
        setIsLoading(false);
        return;
      }

      setSchemaMissing(false);

      const userProfile = (profileRes.data as UserProfile | null) ?? null;
      const adminActive = Boolean(adminRes.data?.is_active);
      const userMemberships = (membershipsRes.data as CompanyMembership[] | null) ?? [];
      const accessibleCompanies = ((companiesRes.data as Company[] | null) ?? []).filter(
        (c) => adminActive || c.is_active
      );

      setProfile(userProfile);
      setIsPlatformAdmin(adminActive);
      setMemberships(userMemberships);
      setCompanies(accessibleCompanies);

      if (!adminActive && accessibleCompanies.length === 0) {
        const setupNeededRes = await supabase.rpc('is_platform_setup_needed');
        setIsPlatformSetupNeeded(Boolean(setupNeededRes.data));
      } else {
        setIsPlatformSetupNeeded(false);
      }

      setSelectedCompanyId((prev) => {
        if (prev && accessibleCompanies.some((c) => c.id === prev)) {
          return prev;
        }
        if (
          userProfile?.default_company_id &&
          accessibleCompanies.some((c) => c.id === userProfile.default_company_id)
        ) {
          return userProfile.default_company_id;
        }
        const firstMemberCompany = accessibleCompanies.find((c) =>
          userMemberships.some((m) => m.company_id === c.id)
        );
        return firstMemberCompany?.id ?? accessibleCompanies[0]?.id ?? null;
      });
    } catch (err) {
      setAuthError(translateSupabaseError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      void loadUserAndTenantData(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      void loadUserAndTenantData(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserAndTenantData]);

  const activeCompany = useMemo(() => {
    if (!companies.length) return null;
    return companies.find((c) => c.id === selectedCompanyId) ?? companies[0] ?? null;
  }, [companies, selectedCompanyId]);

  useEffect(() => {
    applyBrandVariables(activeCompany);
    if (activeCompany) {
      try {
        localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, activeCompany.id);
      } catch {
        // Ignora bloqueio de storage do navegador
      }
    }
  }, [activeCompany]);

  // Carrega o perfil técnico do usuário na empresa ativa (quando aplicável)
  useEffect(() => {
    let active = true;
    if (!session?.user || !activeCompany || schemaMissing) {
      setMyTechnician(null);
      return;
    }

    supabase
      .from('technicians')
      .select('*')
      .eq('company_id', activeCompany.id)
      .eq('user_id', session.user.id)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setMyTechnician((data as Technician | null) ?? null);
        }
      });

    return () => {
      active = false;
    };
  }, [session?.user, activeCompany, schemaMissing]);

  const effectiveRole = useMemo<EffectiveRole | null>(() => {
    if (!session?.user) return null;
    if (isPlatformAdmin) return 'platform_admin';
    if (!activeCompany) return null;
    const membership = memberships.find(
      (m) => m.company_id === activeCompany.id && m.is_active
    );
    return membership?.role ?? null;
  }, [session?.user, isPlatformAdmin, activeCompany, memberships]);

  const permissions = useMemo(() => getPermissionsForRole(effectiveRole), [effectiveRole]);

  const selectCompany = useCallback(
    (companyId: string) => {
      setSelectedCompanyId(companyId);
      if (session?.user) {
        void supabase
          .from('profiles')
          .update({ default_company_id: companyId })
          .eq('id', session.user.id);
      }
    },
    [session?.user]
  );

  const refreshTenantContext = useCallback(async () => {
    await loadUserAndTenantData(session);
  }, [loadUserAndTenantData, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    try {
      localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<AuthTenantContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      isLoading,
      schemaMissing,
      isPlatformAdmin,
      isPlatformSetupNeeded,
      companies,
      memberships,
      activeCompany,
      effectiveRole,
      permissions,
      myTechnician,
      authError,
      selectCompany,
      refreshTenantContext,
      signOut,
    }),
    [
      session,
      profile,
      isLoading,
      schemaMissing,
      isPlatformAdmin,
      isPlatformSetupNeeded,
      companies,
      memberships,
      activeCompany,
      effectiveRole,
      permissions,
      myTechnician,
      authError,
      selectCompany,
      refreshTenantContext,
      signOut,
    ]
  );

  return <AuthTenantContext.Provider value={value}>{children}</AuthTenantContext.Provider>;
};

export function useAuthTenant(): AuthTenantContextValue {
  const ctx = useContext(AuthTenantContext);
  if (!ctx) {
    throw new Error('useAuthTenant deve ser utilizado dentro de AuthTenantProvider');
  }
  return ctx;
}
