import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Search,
  ShoppingCart,
  X,
  Plus,
  Minus,
  Check,
  Copy,
  Receipt,
  Clock,
  Sparkles,
  ClipboardList,
  AlertCircle,
  Filter,
  Edit3,
  Power,
  History,
  Loader2,
  ShieldCheck,
  Percent,
  RefreshCw,
} from 'lucide-react';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { supabase } from '../lib/supabase';
import {
  translateSupabaseError,
  isSchemaMissingError,
  isMissingColumnError,
} from '../lib/errors';
import {
  companyDiscountsSchema,
  priceCatalogItemSchema,
  zodErrorsToMap,
} from '../lib/validation';
import {
  resolveCatalogItemPricing,
  formatDiscountPercent,
} from '../lib/catalogPricing';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { CheckboxField, InputField } from '../components/ui/FormField';
import { AlertBanner } from '../components/ui/EmptyState';
import { INITIAL_CATALOG_ITEMS } from '../data/priceCatalogData';
import type {
  PaymentModality,
  OrderItemStatus,
  PriceCatalogHistoryItem,
  PriceCatalogItem,
  ServiceOrder,
} from '../types/database';

export interface CatalogViewItem {
  id: string; // UUID no Supabase (ou fallback string)
  isDbRecord: boolean;
  code: string;
  category: string;
  subcategory: string;
  description: string;
  condition: string;
  price_term: number;
  price_cash: number;
  discount_cash_percent: number | null;
  discount_term_percent: number | null;
  difference: number;
  is_active: boolean;
}

export interface SelectedBudgetItem {
  item: CatalogViewItem;
  quantity: number;
  status: OrderItemStatus;
  notes: string;
  equipmentInfo?: string;
}

const CONDITION_OPTIONS = ['Nova', 'Conserto', 'Serviço', 'Usada'];

export const PriceCatalogPage: React.FC = () => {
  const { activeCompany, permissions, user, refreshTenantContext } = useAuthTenant();

  // Itens reais carregados do Supabase
  const [catalogItems, setCatalogItems] = useState<CatalogViewItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Modalidade de pagamento selecionada
  const [modality, setModality] = useState<PaymentModality>('cash');

  // Filtros de busca
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
  const [selectedCondition, setSelectedCondition] = useState<string>('Todas');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');

  // Itens selecionados no orçamento da OS
  const [selectedItems, setSelectedItems] = useState<Record<string, SelectedBudgetItem>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Vínculo com OS
  const [availableOrders, setAvailableOrders] = useState<ServiceOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [isSavingToOS, setIsSavingToOS] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal de Cadastro / Edição de Item do Catálogo (Somente Gestor)
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogViewItem | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formSubcategory, setFormSubcategory] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCondition, setFormCondition] = useState('Nova');
  const [formPriceCash, setFormPriceCash] = useState('');
  const [formPriceTerm, setFormPriceTerm] = useState('');
  const [formDiscountCash, setFormDiscountCash] = useState('');
  const [formDiscountTerm, setFormDiscountTerm] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formSubmitErr, setFormSubmitErr] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Modal de Descontos Comerciais por Modalidade (Somente Gestor)
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [companyDiscCashInput, setCompanyDiscCashInput] = useState('0');
  const [companyDiscTermInput, setCompanyDiscTermInput] = useState('0');
  const [discountFormErrors, setDiscountFormErrors] = useState<Record<string, string>>({});
  const [discountFormErr, setDiscountFormErr] = useState<string | null>(null);
  const [savingCompanyDiscounts, setSavingCompanyDiscounts] = useState(false);

  // Modal de Histórico de Alterações de Preço (Somente Gestor)
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyFilterCode, setHistoryFilterCode] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<PriceCatalogHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySchemaMissing, setHistorySchemaMissing] = useState(false);

  const companyDiscountCash = Number(activeCompany?.discount_cash_percent ?? 0);
  const companyDiscountTerm = Number(activeCompany?.discount_term_percent ?? 0);

  const formatBRL = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const getItemPricing = useCallback(
    (item: CatalogViewItem, targetModality: PaymentModality = modality) =>
      resolveCatalogItemPricing({
        baseCash: item.price_cash,
        baseTerm: item.price_term,
        itemDiscountCash: item.discount_cash_percent,
        itemDiscountTerm: item.discount_term_percent,
        companyDiscountCash,
        companyDiscountTerm,
        modality: targetModality,
      }),
    [companyDiscountCash, companyDiscountTerm, modality]
  );

  // Carrega o catálogo oficial real de public.price_catalog_items
  const loadCatalog = useCallback(async (silent = false) => {
    if (!activeCompany) return;
    if (!silent) setLoadingCatalog(true);
    setCatalogError(null);

    const { data, error } = await supabase
      .from('price_catalog_items')
      .select('*')
      .eq('company_id', activeCompany.id)
      .order('code', { ascending: true });

    if (error) {
      setCatalogError(translateSupabaseError(error));
      setLoadingCatalog(false);
      return;
    }

    if (data && data.length > 0) {
      const mapped = (data as PriceCatalogItem[]).map((row) => {
        const cash = Number(row.price_cash || 0);
        const term = Number(row.price_term || 0);
        return {
          id: row.id,
          isDbRecord: true,
          code: row.code,
          category: row.category,
          subcategory: row.subcategory ?? '',
          description: row.description,
          condition: row.condition,
          price_term: term,
          price_cash: cash,
          discount_cash_percent:
            row.discount_cash_percent !== null && row.discount_cash_percent !== undefined
              ? Number(row.discount_cash_percent)
              : null,
          discount_term_percent:
            row.discount_term_percent !== null && row.discount_term_percent !== undefined
              ? Number(row.discount_term_percent)
              : null,
          difference: Math.max(0, Number((term - cash).toFixed(2))),
          is_active: row.is_active,
        };
      });
      setCatalogItems(mapped);
    } else {
      // Fallback apenas caso a empresa ainda esteja vazia em ambiente de teste sem seed
      setCatalogItems(
        INITIAL_CATALOG_ITEMS.map((it) => ({
          id: String(it.id),
          isDbRecord: false,
          code: it.code,
          category: it.category,
          subcategory: it.subcategory,
          description: it.description,
          condition: it.condition,
          price_term: it.price_term,
          price_cash: it.price_cash,
          discount_cash_percent: null,
          discount_term_percent: null,
          difference: it.difference,
          is_active: true,
        }))
      );
    }

    setLastSyncedAt(new Date());
    setLoadingCatalog(false);
  }, [activeCompany]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Atualização automática (Supabase Realtime + retorno de foco da janela)
  useEffect(() => {
    if (!activeCompany?.id) return;

    const channel = supabase
      .channel(`catalog-sync-${activeCompany.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'price_catalog_items',
          filter: `company_id=eq.${activeCompany.id}`,
        },
        () => {
          void loadCatalog(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'companies',
          filter: `id=eq.${activeCompany.id}`,
        },
        () => {
          void refreshTenantContext();
          void loadCatalog(true);
        }
      )
      .subscribe();

    const handleFocus = () => {
      void refreshTenantContext();
      void loadCatalog(true);
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      void supabase.removeChannel(channel);
    };
  }, [activeCompany?.id, loadCatalog, refreshTenantContext]);

  // Carregar OS ativas para vinculação
  useEffect(() => {
    if (!activeCompany) return;

    let isSubscribed = true;
    supabase
      .from('service_orders')
      .select('id, order_number, title, status, client:clients(name)')
      .eq('company_id', activeCompany.id)
      .in('status', ['open', 'scheduled', 'in_progress'])
      .order('order_number', { ascending: false })
      .then(({ data }) => {
        if (isSubscribed && data) {
          setAvailableOrders(data as unknown as ServiceOrder[]);
          if (data.length > 0 && !selectedOrderId) {
            setSelectedOrderId(data[0].id);
          }
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, [activeCompany, selectedOrderId]);

  // Toast auto-clear
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Sugere o próximo código CAT-NNN disponível
  const suggestNextCode = () => {
    let maxNum = 130;
    for (const it of catalogItems) {
      const m = it.code.match(/^CAT-(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    return `CAT-${String(maxNum + 1).padStart(3, '0')}`;
  };

  // Abre modal de Configuração de Descontos Comerciais (Gestor)
  const openDiscountConfigModal = () => {
    setCompanyDiscCashInput(String(companyDiscountCash));
    setCompanyDiscTermInput(String(companyDiscountTerm));
    setDiscountFormErrors({});
    setDiscountFormErr(null);
    setDiscountModalOpen(true);
  };

  const handleSaveCompanyDiscounts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany || !permissions.canManagePriceCatalog) return;

    setDiscountFormErrors({});
    setDiscountFormErr(null);

    const parsed = companyDiscountsSchema.safeParse({
      discount_cash_percent: companyDiscCashInput.replace(',', '.'),
      discount_term_percent: companyDiscTermInput.replace(',', '.'),
    });

    if (!parsed.success) {
      setDiscountFormErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setSavingCompanyDiscounts(true);
    const { error } = await supabase
      .from('companies')
      .update({
        discount_cash_percent: Number(parsed.data.discount_cash_percent.toFixed(2)),
        discount_term_percent: Number(parsed.data.discount_term_percent.toFixed(2)),
      })
      .eq('id', activeCompany.id);

    setSavingCompanyDiscounts(false);

    if (error) {
      if (isMissingColumnError(error)) {
        setDiscountFormErr(
          'A migração 007_catalog_configurable_discounts.sql ainda não foi executada no Supabase remoto. Execute-a no SQL Editor para salvar descontos globais.'
        );
      } else {
        setDiscountFormErr(translateSupabaseError(error));
      }
      return;
    }

    setDiscountModalOpen(false);
    await refreshTenantContext();
    await loadCatalog(true);
    setToastMessage('Descontos comerciais padrão da empresa atualizados!');
  };

  // Abre modal para Novo Item (Gestor)
  const openCreateModal = () => {
    setEditingItem(null);
    setFormCode(suggestNextCode());
    setFormCategory(
      selectedCategory !== 'Todas' ? selectedCategory : 'Peças Gerais'
    );
    setFormSubcategory('');
    setFormDescription('');
    setFormCondition('Nova');
    setFormPriceCash('');
    setFormPriceTerm('');
    setFormDiscountCash('');
    setFormDiscountTerm('');
    setFormIsActive(true);
    setFormErrors({});
    setFormSubmitErr(null);
    setItemModalOpen(true);
  };

  // Abre modal para Editar Item (Gestor)
  const openEditModal = (item: CatalogViewItem) => {
    setEditingItem(item);
    setFormCode(item.code);
    setFormCategory(item.category);
    setFormSubcategory(item.subcategory);
    setFormDescription(item.description);
    setFormCondition(item.condition);
    setFormPriceCash(String(item.price_cash.toFixed(2)));
    setFormPriceTerm(String(item.price_term.toFixed(2)));
    setFormDiscountCash(
      item.discount_cash_percent !== null && item.discount_cash_percent !== undefined
        ? String(item.discount_cash_percent)
        : ''
    );
    setFormDiscountTerm(
      item.discount_term_percent !== null && item.discount_term_percent !== undefined
        ? String(item.discount_term_percent)
        : ''
    );
    setFormIsActive(item.is_active);
    setFormErrors({});
    setFormSubmitErr(null);
    setItemModalOpen(true);
  };

  // Salva criação ou edição no Supabase
  const handleSaveCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany || !permissions.canManagePriceCatalog) return;

    setFormErrors({});
    setFormSubmitErr(null);

    const parsed = priceCatalogItemSchema.safeParse({
      code: formCode.toUpperCase(),
      category: formCategory,
      subcategory: formSubcategory || undefined,
      description: formDescription,
      condition: formCondition,
      price_cash: formPriceCash.replace(',', '.'),
      price_term: formPriceTerm.replace(',', '.'),
      discount_cash_percent: formDiscountCash.trim(),
      discount_term_percent: formDiscountTerm.trim(),
      is_active: formIsActive,
    });

    if (!parsed.success) {
      setFormErrors(zodErrorsToMap(parsed.error));
      return;
    }

    setSavingItem(true);

    const basePayload = {
      company_id: activeCompany.id,
      code: parsed.data.code,
      category: parsed.data.category,
      subcategory: parsed.data.subcategory || null,
      description: parsed.data.description,
      condition: parsed.data.condition,
      price_cash: Number(parsed.data.price_cash.toFixed(2)),
      price_term: Number(parsed.data.price_term.toFixed(2)),
      is_active: parsed.data.is_active,
    };

    const fullPayload = {
      ...basePayload,
      discount_cash_percent:
        parsed.data.discount_cash_percent !== null
          ? Number(parsed.data.discount_cash_percent.toFixed(2))
          : null,
      discount_term_percent:
        parsed.data.discount_term_percent !== null
          ? Number(parsed.data.discount_term_percent.toFixed(2))
          : null,
    };

    const hasCustomDiscount =
      fullPayload.discount_cash_percent !== null ||
      fullPayload.discount_term_percent !== null;

    if (editingItem && editingItem.isDbRecord) {
      let { error } = await supabase
        .from('price_catalog_items')
        .update(fullPayload)
        .eq('id', editingItem.id)
        .eq('company_id', activeCompany.id);

      if (error && isMissingColumnError(error) && !hasCustomDiscount) {
        const retry = await supabase
          .from('price_catalog_items')
          .update(basePayload)
          .eq('id', editingItem.id)
          .eq('company_id', activeCompany.id);
        error = retry.error;
      }

      setSavingItem(false);
      if (error) {
        setFormSubmitErr(
          isMissingColumnError(error)
            ? 'Para salvar exceções de desconto por item, execute a migração 007_catalog_configurable_discounts.sql no SQL Editor do Supabase.'
            : translateSupabaseError(error)
        );
        return;
      }

      setToastMessage(`Item ${fullPayload.code} atualizado com sucesso no catálogo!`);
    } else {
      let { error } = await supabase.from('price_catalog_items').insert({
        ...fullPayload,
        created_by: user?.id ?? null,
      });

      if (error && isMissingColumnError(error) && !hasCustomDiscount) {
        const retry = await supabase.from('price_catalog_items').insert({
          ...basePayload,
          created_by: user?.id ?? null,
        });
        error = retry.error;
      }

      setSavingItem(false);
      if (error) {
        setFormSubmitErr(
          isMissingColumnError(error)
            ? 'Para salvar exceções de desconto por item, execute a migração 007_catalog_configurable_discounts.sql no SQL Editor do Supabase.'
            : translateSupabaseError(error)
        );
        return;
      }

      setToastMessage(`Novo item ${fullPayload.code} adicionado ao catálogo oficial!`);
    }

    setItemModalOpen(false);
    await loadCatalog();
  };

  // Ativa / Desativa rapidamente um item
  const handleToggleItemActive = async (item: CatalogViewItem) => {
    if (!activeCompany || !permissions.canManagePriceCatalog || !item.isDbRecord) return;
    setTogglingId(item.id);
    const nextState = !item.is_active;

    const { error } = await supabase
      .from('price_catalog_items')
      .update({ is_active: nextState })
      .eq('id', item.id)
      .eq('company_id', activeCompany.id);

    setTogglingId(null);
    if (error) {
      setToastMessage(`Erro: ${translateSupabaseError(error)}`);
      return;
    }

    setToastMessage(
      nextState
        ? `Item ${item.code} reativado no catálogo.`
        : `Item ${item.code} desativado (oculto para técnicos).`
    );
    await loadCatalog();
  };

  // Abre modal de Histórico de Alterações de Preços
  const openHistoryModal = async (filterItem?: CatalogViewItem) => {
    if (!activeCompany || !permissions.canManagePriceCatalog) return;
    setHistoryFilterCode(filterItem ? filterItem.code : null);
    setHistoryModalOpen(true);
    setLoadingHistory(true);
    setHistorySchemaMissing(false);

    let query = supabase
      .from('price_catalog_history')
      .select('*')
      .eq('company_id', activeCompany.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (filterItem && filterItem.isDbRecord) {
      query = query.eq('catalog_item_id', filterItem.id);
    }

    const { data, error } = await query;

    if (error) {
      if (isSchemaMissingError(error)) {
        setHistorySchemaMissing(true);
      } else {
        setToastMessage(translateSupabaseError(error));
      }
      setHistoryRows([]);
    } else {
      setHistoryRows((data as PriceCatalogHistoryItem[]) ?? []);
    }

    setLoadingHistory(false);
  };

  // Categorias disponíveis dinamicamente a partir dos itens carregados
  const existingCategoriesOnly = useMemo(() => {
    const set = new Set<string>();
    catalogItems.forEach((it) => {
      if (it.category) set.add(it.category);
    });
    return Array.from(set).sort();
  }, [catalogItems]);

  const categories = useMemo(
    () => ['Todas', ...existingCategoriesOnly],
    [existingCategoriesOnly]
  );

  // Itens base considerando permissão e filtro de ativo/inativo
  const visibleBaseItems = useMemo(() => {
    if (!permissions.canManagePriceCatalog) {
      return catalogItems.filter((it) => it.is_active);
    }
    if (statusFilter === 'active') return catalogItems.filter((it) => it.is_active);
    if (statusFilter === 'inactive') return catalogItems.filter((it) => !it.is_active);
    return catalogItems;
  }, [catalogItems, permissions.canManagePriceCatalog, statusFilter]);

  // Itens filtrados por categoria, condição e busca
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return visibleBaseItems.filter((item) => {
      if (selectedCategory !== 'Todas' && item.category !== selectedCategory) {
        return false;
      }
      if (selectedCondition !== 'Todas' && item.condition !== selectedCondition) {
        return false;
      }
      if (!q) return true;

      const inCode = item.code.toLowerCase().includes(q);
      const inDesc = item.description.toLowerCase().includes(q);
      const inCat = item.category.toLowerCase().includes(q);
      const inSubcat = item.subcategory.toLowerCase().includes(q);

      return inCode || inDesc || inCat || inSubcat;
    });
  }, [visibleBaseItems, searchQuery, selectedCategory, selectedCondition]);

  // Manipulação do orçamento
  const handleAddItem = (item: CatalogViewItem) => {
    if (!item.is_active) {
      setToastMessage('Este item está inativo e não pode ser adicionado a novos orçamentos.');
      return;
    }
    setSelectedItems((prev) => {
      const existing = prev[item.id];
      if (existing) {
        return {
          ...prev,
          [item.id]: { ...existing, quantity: existing.quantity + 1 },
        };
      }
      return {
        ...prev,
        [item.id]: {
          item,
          quantity: 1,
          status: 'proposed',
          notes: '',
        },
      };
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setSelectedItems((prev) => {
      const existing = prev[itemId];
      if (!existing) return prev;
      const newQty = existing.quantity + delta;
      if (newQty <= 0) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return {
        ...prev,
        [itemId]: { ...existing, quantity: newQty },
      };
    });
  };

  const handleUpdateStatus = (itemId: string, status: OrderItemStatus) => {
    if (status === 'authorized' && !permissions.canApproveOrderItems) {
      setToastMessage('Apenas gestores da empresa ou clientes podem autorizar formalmente itens no orçamento.');
      return;
    }
    const current = selectedItems[itemId];
    if (status === 'applied' && current && current.status !== 'authorized' && !permissions.canApproveOrderItems) {
      setToastMessage('A peça só pode ser marcada como aplicada após prévia autorização.');
      return;
    }

    setSelectedItems((prev) => {
      const existing = prev[itemId];
      if (!existing) return prev;
      return {
        ...prev,
        [itemId]: { ...existing, status },
      };
    });
  };

  const handleUpdateNotes = (itemId: string, notes: string) => {
    setSelectedItems((prev) => {
      const existing = prev[itemId];
      if (!existing) return prev;
      return {
        ...prev,
        [itemId]: { ...existing, notes },
      };
    });
  };

  const handleRemoveItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleClearAll = () => {
    setSelectedItems({});
  };

  const selectionList = useMemo(() => Object.values(selectedItems), [selectedItems]);
  const totalCount = useMemo(
    () => selectionList.reduce((acc, curr) => acc + curr.quantity, 0),
    [selectionList]
  );

  const calculateSubtotal = (items: SelectedBudgetItem[]) => {
    return items.reduce((acc, curr) => {
      const pricing = getItemPricing(curr.item);
      return acc + pricing.finalUnitPrice * curr.quantity;
    }, 0);
  };

  const totalCurrentModality = calculateSubtotal(selectionList);
  const totalBaseCurrentModality = selectionList.reduce((acc, curr) => {
    const pricing = getItemPricing(curr.item);
    return acc + pricing.basePrice * curr.quantity;
  }, 0);
  const totalDiscountSavings = Math.max(
    0,
    Number((totalBaseCurrentModality - totalCurrentModality).toFixed(2))
  );
  const totalOtherModality = selectionList.reduce((acc, curr) => {
    const pricing = getItemPricing(curr.item, modality === 'cash' ? 'term' : 'cash');
    return acc + pricing.finalUnitPrice * curr.quantity;
  }, 0);

  const savings = modality === 'cash' ? Math.max(0, totalOtherModality - totalCurrentModality) : totalDiscountSavings;

  const proposedTotal = calculateSubtotal(selectionList.filter((i) => i.status === 'proposed'));
  const authorizedTotal = calculateSubtotal(selectionList.filter((i) => i.status === 'authorized'));
  const appliedTotal = calculateSubtotal(selectionList.filter((i) => i.status === 'applied'));

  const handleCopySummary = () => {
    if (selectionList.length === 0) return;

    const modalityText =
      modality === 'cash' ? 'À Vista / Boleto 3 Dias' : 'Boleto 20/40 Dias';

    let text = `*${activeCompany?.name || 'EA BALANÇAS'} — ORÇAMENTO DE PEÇAS & SERVIÇOS*\n`;
    text += `*Modalidade:* ${modalityText}\n`;
    text += `*Itens selecionados:* ${totalCount}\n`;
    text += `-------------------------------------------\n`;

    selectionList.forEach(({ item, quantity, status, notes }) => {
      const pricing = getItemPricing(item);
      const sub = Number((pricing.finalUnitPrice * quantity).toFixed(2));
      const statusLabel =
        status === 'applied' ? '✅ Aplicado' : status === 'authorized' ? '👍 Autorizado' : '📝 Proposto';

      text += `• ${quantity}x [${item.code}] ${item.description}\n`;
      if (pricing.discountPercent > 0) {
        text += `  Base: ${formatBRL(pricing.basePrice)} | Desconto autorizado: ${formatDiscountPercent(
          pricing.discountPercent
        )} | Final: ${formatBRL(pricing.finalUnitPrice)} | Subtotal: ${formatBRL(sub)} | Status: ${statusLabel}\n`;
      } else {
        text += `  Valor: ${formatBRL(pricing.finalUnitPrice)} | Subtotal: ${formatBRL(sub)} | Status: ${statusLabel}\n`;
      }
      if (notes) text += `  Obs: ${notes}\n`;
    });

    text += `-------------------------------------------\n`;
    if (totalDiscountSavings > 0) {
      text += `🏷️ Desconto comercial aplicado: -${formatBRL(totalDiscountSavings)}\n`;
    }
    if (modality === 'cash' && savings > totalDiscountSavings) {
      text += `💰 Economia total à vista: ${formatBRL(savings)}\n`;
    }
    text += `*VALOR TOTAL: ${formatBRL(totalCurrentModality)}*\n`;

    navigator.clipboard.writeText(text);
    setToastMessage('Resumo do orçamento copiado para a área de transferência!');
  };

  const handleSaveToServiceOrder = async () => {
    if (!activeCompany || !selectedOrderId || selectionList.length === 0) return;

    setIsSavingToOS(true);
    try {
      const fullRecords = selectionList.map(({ item, quantity, status, notes }) => {
        const pricing = getItemPricing(item);
        const total = Number((pricing.finalUnitPrice * quantity).toFixed(2));
        const discountTotal = Number((pricing.discountAmountPerUnit * quantity).toFixed(2));

        return {
          company_id: activeCompany.id,
          service_order_id: selectedOrderId,
          catalog_item_id: item.isDbRecord ? item.id : null,
          item_code: item.code,
          description: item.description,
          category: item.category,
          condition: item.condition,
          payment_modality: modality,
          quantity,
          base_unit_price: pricing.basePrice,
          discount_percent: pricing.discountPercent,
          unit_price: pricing.finalUnitPrice,
          discount_amount: discountTotal,
          total_price: total,
          item_status: status,
          notes: notes || null,
        };
      });

      let { error } = await supabase.from('service_order_items').insert(fullRecords);

      if (error && isMissingColumnError(error)) {
        const legacyRecords = fullRecords.map((rec) => {
          const { base_unit_price: _b, discount_percent: _d, ...rest } = rec;
          return rest;
        });
        const retry = await supabase.from('service_order_items').insert(legacyRecords);
        error = retry.error;
      }

      if (error) {
        setToastMessage(`Erro ao vincular itens: ${translateSupabaseError(error)}`);
      } else {
        setToastMessage('Itens gravados com sucesso na Ordem de Serviço!');
        setSelectedItems({});
      }
      setIsDrawerOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao vincular à OS';
      setToastMessage(`Aviso: ${message}`);
    } finally {
      setIsSavingToOS(false);
    }
  };

  const activeCount = catalogItems.filter((i) => i.is_active).length;
  const inactiveCount = catalogItems.length - activeCount;

  return (
    <div className="space-y-6 pb-20">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-sm px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Tabela de Preços &amp; Catálogo de Peças
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
              {activeCount} Itens Ativos
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {permissions.canManagePriceCatalog
              ? 'Gerencie peças, serviços, preços à vista e a prazo e componha orçamentos vinculados às OS.'
              : 'Consulta rápida de peças e serviços ativos para composição de orçamentos em campo.'}
          </p>
        </div>

        {/* Ações do Cabeçalho */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void refreshTenantContext();
              void loadCatalog(true);
            }}
            title={
              lastSyncedAt
                ? `Última sincronização: ${lastSyncedAt.toLocaleTimeString('pt-BR')}`
                : 'Atualizar tabela'
            }
            leftIcon={<RefreshCw className="w-3.5 h-3.5 text-slate-500" />}
          >
            Atualizar
          </Button>

          {permissions.canManagePriceCatalog && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={openDiscountConfigModal}
                leftIcon={<Percent className="w-4 h-4 text-teal-600" />}
              >
                Descontos
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openHistoryModal()}
                leftIcon={<History className="w-4 h-4 text-slate-600" />}
              >
                Histórico
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={openCreateModal}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Novo Item
              </Button>
            </>
          )}

          <button
            onClick={() => setIsDrawerOpen(true)}
            className="relative inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white text-xs sm:text-sm font-medium shadow-sm hover:bg-teal-700 transition-colors focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Orçamento da OS</span>
            {totalCount > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-white text-teal-800">
                {totalCount}
              </span>
            )}
            <span className="font-bold border-l border-teal-500/60 pl-2">
              {formatBRL(totalCurrentModality)}
            </span>
          </button>
        </div>
      </div>

      {catalogError && <AlertBanner variant="error" message={catalogError} />}

      {/* Seletor de Modalidade de Pagamento */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Receipt className="w-4 h-4 text-teal-600" />
            <span className="font-semibold">Modalidade de Faturamento Selecionada:</span>
          </div>
          {(companyDiscountCash > 0 || companyDiscountTerm > 0) && (
            <p className="text-[11px] text-emerald-700 font-medium mt-1">
              Desconto padrão ativo:{' '}
              {companyDiscountCash > 0 && (
                <span className="mr-2">
                  À Vista <strong>{formatDiscountPercent(companyDiscountCash)}</strong>
                </span>
              )}
              {companyDiscountTerm > 0 && (
                <span>
                  Boleto 20/40D <strong>{formatDiscountPercent(companyDiscountTerm)}</strong>
                </span>
              )}
            </p>
          )}
        </div>

        <div className="inline-flex rounded-lg p-1 bg-slate-100 border border-slate-200">
          <button
            type="button"
            onClick={() => setModality('cash')}
            className={`px-3 sm:px-4 py-2 text-xs md:text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${
              modality === 'cash'
                ? 'bg-white text-teal-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-teal-600" />
            <span>À Vista / Boleto 3D</span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
              {companyDiscountCash > 0
                ? `-${formatDiscountPercent(companyDiscountCash)}`
                : 'À Vista'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModality('term')}
            className={`px-3 sm:px-4 py-2 text-xs md:text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${
              modality === 'term'
                ? 'bg-white text-teal-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>Boleto 20/40D</span>
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${
                companyDiscountTerm > 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {companyDiscountTerm > 0
                ? `-${formatDiscountPercent(companyDiscountTerm)}`
                : 'A Prazo'}
            </span>
          </button>
        </div>
      </div>

      {/* Filtros e Barra de Busca */}
      <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por descrição, código (ex.: CAT-001), Toledo Prix 3, 4, 5, 6..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-9 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCondition}
              onChange={(e) => setSelectedCondition(e.target.value)}
              className="text-xs py-2 px-3 rounded-lg border border-slate-300 bg-white font-medium text-slate-700 focus:ring-2 focus:ring-teal-500"
            >
              <option value="Todas">Todas as Condições</option>
              <option value="Nova">Nova</option>
              <option value="Conserto">Conserto</option>
              <option value="Serviço">Serviço</option>
            </select>

            {permissions.canManagePriceCatalog && (
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'active' | 'inactive' | 'all')
                }
                className="text-xs py-2 px-3 rounded-lg border border-slate-300 bg-white font-medium text-slate-700 focus:ring-2 focus:ring-teal-500"
              >
                <option value="active">Somente Ativos ({activeCount})</option>
                <option value="inactive">Inativos ({inactiveCount})</option>
                <option value="all">Todos ({catalogItems.length})</option>
              </select>
            )}
          </div>
        </div>

        {/* Pílulas de Categorias */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            const count =
              cat === 'Todas'
                ? visibleBaseItems.length
                : visibleBaseItems.filter((i) => i.category === cat).length;

            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full shrink-0 font-medium transition-colors ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat} <span className="opacity-75 text-[11px]">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Resultados da Listagem */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-500 mb-3 px-1">
          <span>
            Exibindo <strong>{filteredItems.length}</strong> de {visibleBaseItems.length} itens
          </span>
          <span className="text-slate-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
            {permissions.canManagePriceCatalog
              ? 'Modo Gestão — OSs já aprovadas preservam preço histórico'
              : 'Preços oficiais protegidos contra alteração'}
          </span>
        </div>

        {loadingCatalog ? (
          <div className="bg-white rounded-xl border border-slate-200 py-14 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
            Carregando catálogo oficial de preços...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-12 text-center text-xs text-slate-500 space-y-2">
            <p className="font-semibold text-slate-700">
              Nenhum item encontrado com esses filtros.
            </p>
            <p>Ajuste a busca, categoria ou status selecionado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => {
              const selected = selectedItems[item.id];
              const pricing = getItemPricing(item);
              const otherPricing = getItemPricing(
                item,
                modality === 'cash' ? 'term' : 'cash'
              );
              const isNova = item.condition.toLowerCase().includes('nova');

              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-xl border p-4 flex flex-col justify-between transition-all hover:shadow-md ${
                    !item.is_active
                      ? 'opacity-70 border-slate-200 bg-slate-50/70'
                      : selected
                      ? 'border-teal-500 ring-1 ring-teal-500/30 bg-teal-50/10'
                      : 'border-slate-200/90'
                  }`}
                >
                  <div>
                    {/* Cabeçalho do Card */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {item.code}
                        </span>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          {item.category}
                        </span>
                        {!item.is_active && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-red-100 text-red-700">
                            Inativo
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0 ${
                          isNova
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {item.condition}
                      </span>
                    </div>

                    {/* Descrição */}
                    <h3 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
                      {item.description}
                    </h3>

                    {item.subcategory && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                        {item.subcategory}
                      </p>
                    )}
                  </div>

                  {/* Preço e Ações */}
                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-2.5">
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5 flex-wrap">
                          <span>
                            {modality === 'cash' ? 'À vista / 3 dias:' : 'Boleto 20/40 dias:'}
                          </span>
                          {pricing.discountPercent > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              -{formatDiscountPercent(pricing.discountPercent)}{' '}
                              {pricing.discountSource === 'item' ? 'Exceção' : 'Padrão'}
                            </span>
                          )}
                        </div>

                        {pricing.discountPercent > 0 && (
                          <div className="text-[11px] text-slate-400 line-through">
                            Base: {formatBRL(pricing.basePrice)}
                          </div>
                        )}

                        <div className="text-lg font-bold text-slate-900">
                          {formatBRL(pricing.finalUnitPrice)}
                        </div>

                        {modality === 'cash' && otherPricing.finalUnitPrice > pricing.finalUnitPrice && (
                          <div className="text-[10px] text-emerald-600 font-medium">
                            Prazo: {formatBRL(otherPricing.finalUnitPrice)}
                          </div>
                        )}
                        {modality === 'term' && (
                          <div className="text-[10px] text-slate-400">
                            À vista: {formatBRL(otherPricing.finalUnitPrice)}
                          </div>
                        )}
                      </div>

                      {/* Controle de Adição ao Orçamento */}
                      {item.is_active &&
                        (selected ? (
                          <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
                            <button
                              onClick={() => handleUpdateQuantity(item.id, -1)}
                              className="w-7 h-7 rounded bg-white text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold text-xs shadow-xs"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-6 text-center text-xs font-bold text-slate-900">
                              {selected.quantity}
                            </span>
                            <button
                              onClick={() => handleUpdateQuantity(item.id, 1)}
                              className="w-7 h-7 rounded bg-teal-600 text-white hover:bg-teal-700 flex items-center justify-center font-bold text-xs shadow-xs"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddItem(item)}
                            leftIcon={<Plus className="w-3.5 h-3.5 text-teal-600" />}
                            className="border-slate-300 hover:border-teal-600 hover:text-teal-700"
                          >
                            Adicionar
                          </Button>
                        ))}
                    </div>

                    {/* Ações Exclusivas do Gestor (Editar, Desativar/Ativar, Histórico) */}
                    {permissions.canManagePriceCatalog && item.isDbRecord && (
                      <div className="pt-2 border-t border-dashed border-slate-200 flex items-center justify-between gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="inline-flex items-center gap-1 text-slate-600 hover:text-teal-700 font-semibold transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Editar
                        </button>

                        <button
                          type="button"
                          onClick={() => void openHistoryModal(item)}
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 font-medium transition-colors"
                        >
                          <History className="w-3.5 h-3.5" />
                          Histórico
                        </button>

                        <button
                          type="button"
                          disabled={togglingId === item.id}
                          onClick={() => void handleToggleItemActive(item)}
                          className={`inline-flex items-center gap-1 font-semibold transition-colors ${
                            item.is_active
                              ? 'text-amber-700 hover:text-red-700'
                              : 'text-emerald-700 hover:text-emerald-800'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                          {togglingId === item.id
                            ? 'Atualizando...'
                            : item.is_active
                            ? 'Desativar'
                            : 'Reativar'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Cadastro / Edição de Item do Catálogo (Somente Gestor) */}
      <Modal
        isOpen={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        title={
          editingItem
            ? `Editar Item — ${editingItem.code}`
            : 'Novo Item no Catálogo Oficial'
        }
        subtitle="Produtos, peças e serviços disponíveis para orçamentos e Ordens de Serviço"
        footer={
          <>
            <Button variant="outline" onClick={() => setItemModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="catalog-item-form" isLoading={savingItem}>
              {editingItem ? 'Salvar Alterações' : 'Cadastrar Item'}
            </Button>
          </>
        }
      >
        <form
          id="catalog-item-form"
          onSubmit={handleSaveCatalogItem}
          className="space-y-4"
        >
          {formSubmitErr && <AlertBanner variant="error" message={formSubmitErr} />}

          {editingItem && (
            <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-[11px] text-sky-900">
              <strong>Preservação Histórica:</strong> Alterar os valores aqui atualiza somente novos orçamentos. Itens já autorizados ou concluídos em Ordens de Serviço mantêm seus preços originais.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Código do Item"
              required
              placeholder="Ex.: CAT-131 ou SRV-010"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value.toUpperCase())}
              error={formErrors.code}
            />

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Condição / Tipo *
              </label>
              <select
                value={formCondition}
                onChange={(e) => setFormCondition(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {CONDITION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {formErrors.condition && (
                <p className="text-xs text-red-600 mt-1">{formErrors.condition}</p>
              )}
            </div>
          </div>

          <InputField
            label="Nome / Descrição da Peça, Produto ou Serviço"
            required
            placeholder="Ex.: Célula de Carga 30kg Toledo Prix 4 / Calibração com Pesos Padrão"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            error={formErrors.description}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <InputField
                label="Categoria"
                required
                list="catalog-categories-list"
                placeholder="Ex.: Células de Carga, Serviços, Placas..."
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                error={formErrors.category}
              />
              <datalist id="catalog-categories-list">
                {existingCategoriesOnly.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <InputField
              label="Subcategoria / Aplicação (opcional)"
              placeholder="Ex.: Prix 4 Flex / Linha Industrial"
              value={formSubcategory}
              onChange={(e) => setFormSubcategory(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <InputField
              label="Preço À Vista / Boleto 3D (R$)"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="0.00"
              value={formPriceCash}
              onChange={(e) => setFormPriceCash(e.target.value)}
              error={formErrors.price_cash}
            />

            <InputField
              label="Preço A Prazo / Boleto 20/40D (R$)"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="0.00"
              value={formPriceTerm}
              onChange={(e) => setFormPriceTerm(e.target.value)}
              error={formErrors.price_term}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-200">
            <InputField
              label={`Exceção Desconto À Vista (%) — padrão ${formatDiscountPercent(
                companyDiscountCash
              )}`}
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="Vazio = padrão da empresa"
              value={formDiscountCash}
              onChange={(e) => setFormDiscountCash(e.target.value)}
              error={formErrors.discount_cash_percent}
            />

            <InputField
              label={`Exceção Desconto 20/40D (%) — padrão ${formatDiscountPercent(
                companyDiscountTerm
              )}`}
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="Vazio = padrão da empresa"
              value={formDiscountTerm}
              onChange={(e) => setFormDiscountTerm(e.target.value)}
              error={formErrors.discount_term_percent}
            />
          </div>

          <CheckboxField
            label="Item ativo no catálogo"
            description="Quando desmarcado, técnicos não conseguem selecionar este item em novos orçamentos."
            checked={formIsActive}
            onChange={(e) => setFormIsActive(e.target.checked)}
          />
        </form>
      </Modal>

      {/* Modal de Configuração de Descontos Comerciais por Modalidade (Somente Gestor) */}
      <Modal
        isOpen={discountModalOpen}
        onClose={() => setDiscountModalOpen(false)}
        title="Descontos Comerciais por Modalidade"
        subtitle="Percentuais padrão aplicados sobre o preço-base sem alterá-lo permanentemente"
        footer={
          <>
            <Button variant="outline" onClick={() => setDiscountModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="company-discounts-form"
              isLoading={savingCompanyDiscounts}
            >
              Salvar Descontos
            </Button>
          </>
        }
      >
        <form
          id="company-discounts-form"
          onSubmit={handleSaveCompanyDiscounts}
          className="space-y-4"
        >
          {discountFormErr && <AlertBanner variant="error" message={discountFormErr} />}

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
            Estes descontos valem para todo o catálogo da empresa e são refletidos automaticamente para os técnicos. Você pode configurar exceções individuais ao editar qualquer item.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Desconto Padrão À Vista / 3D (%)"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              placeholder="0"
              value={companyDiscCashInput}
              onChange={(e) => setCompanyDiscCashInput(e.target.value)}
              error={discountFormErrors.discount_cash_percent}
            />

            <InputField
              label="Desconto Padrão Boleto 20/40D (%)"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              placeholder="0"
              value={companyDiscTermInput}
              onChange={(e) => setCompanyDiscTermInput(e.target.value)}
              error={discountFormErrors.discount_term_percent}
            />
          </div>
        </form>
      </Modal>

      {/* Modal de Histórico de Alterações de Preços */}
      <Modal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        title={
          historyFilterCode
            ? `Histórico de Preços — ${historyFilterCode}`
            : 'Histórico Geral de Alterações do Catálogo'
        }
        subtitle="Auditoria automática de cadastros, reajustes e ativação de itens"
        maxWidthClass="max-w-2xl"
        footer={
          <Button variant="outline" onClick={() => setHistoryModalOpen(false)}>
            Fechar
          </Button>
        }
      >
        {loadingHistory ? (
          <div className="py-10 text-center text-xs text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-teal-600" />
            Consultando registros de auditoria...
          </div>
        ) : historySchemaMissing ? (
          <AlertBanner
            variant="warning"
            title="Auditoria de Catálogo Pendente de Migração"
            message="A tabela price_catalog_history ainda não foi aplicada no Supabase remoto. Execute a migração 006_price_catalog_audit.sql no SQL Editor para habilitar o histórico automático."
          />
        ) : historyRows.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            Nenhuma alteração de preço ou status registrada após a ativação da auditoria.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto text-xs">
            {historyRows.map((h) => {
              const eventLabels: Record<PriceCatalogHistoryItem['event_type'], string> = {
                created: 'Novo item cadastrado',
                price_updated: 'Alteração de preços',
                updated: 'Dados atualizados',
                activated: 'Item reativado',
                deactivated: 'Item desativado',
              };

              return (
                <div key={h.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-800">
                        {h.item_code}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {eventLabels[h.event_type]}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(h.created_at).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>

                  {h.event_type === 'price_updated' && (
                    <div className="text-[11px] text-slate-600 flex flex-wrap gap-3">
                      <span>
                        À vista:{' '}
                        <span className="line-through text-slate-400">
                          {formatBRL(Number(h.old_price_cash ?? 0))}
                        </span>{' '}
                        →{' '}
                        <strong className="text-emerald-700">
                          {formatBRL(Number(h.new_price_cash ?? 0))}
                        </strong>
                      </span>
                      <span>
                        A prazo:{' '}
                        <span className="line-through text-slate-400">
                          {formatBRL(Number(h.old_price_term ?? 0))}
                        </span>{' '}
                        →{' '}
                        <strong className="text-slate-900">
                          {formatBRL(Number(h.new_price_term ?? 0))}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* Drawer Lateral de Orçamento / Montagem da OS */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-teal-700" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">Orçamento de Peças e Serviços</h2>
                  <p className="text-xs text-slate-500">
                    {totalCount} {totalCount === 1 ? 'item selecionado' : 'itens selecionados'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">Modalidade:</span>
                <span className="font-bold text-teal-800">
                  {modality === 'cash' ? 'À Vista / Boleto 3D' : 'Boleto 20/40D'}
                </span>
              </div>

              <div className="bg-blue-50/60 border border-blue-200/80 rounded-lg p-3 text-xs text-blue-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-blue-700" />
                  Regra de Classificação de Peças:
                </div>
                <div className="text-[11px] text-blue-800/90 leading-relaxed">
                  <strong>Proposto:</strong> orçado pelo técnico. <strong>Autorizado:</strong> aprovado pelo cliente/gestor. <strong>Aplicado:</strong> instalado na balança.
                </div>
              </div>

              {selectionList.length === 0 ? (
                <div className="text-center py-12 text-slate-400 space-y-2">
                  <ShoppingCart className="w-8 h-8 mx-auto stroke-1" />
                  <p className="text-sm">Nenhum item adicionado ao orçamento.</p>
                  <p className="text-xs text-slate-400">
                    Clique em &quot;Adicionar&quot; nos itens do catálogo para montar o orçamento da OS.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectionList.map(({ item, quantity, status, notes }) => {
                    const pricing = getItemPricing(item);
                    const subtotal = pricing.finalUnitPrice * quantity;

                    return (
                      <div
                        key={item.id}
                        className="border border-slate-200 rounded-xl p-3 bg-white space-y-2 shadow-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                {item.code}
                              </span>
                              <span className="text-[10px] font-medium text-slate-500">
                                {item.category}
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-slate-900 leading-snug">
                              {item.description}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveItem(item.id)}
                            className="text-slate-400 hover:text-red-600 p-1"
                            title="Remover item"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1 text-[11px] pt-1">
                          <span className="text-[10px] text-slate-400 mr-1">Status:</span>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(item.id, 'proposed')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                              status === 'proposed'
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            Proposto
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(item.id, 'authorized')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                              status === 'authorized'
                                ? 'bg-sky-100 text-sky-900 border-sky-300'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            Autorizado
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(item.id, 'applied')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                              status === 'applied'
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            Aplicado
                          </button>
                        </div>

                        <input
                          type="text"
                          placeholder="Observação da peça / equipamento vinculado..."
                          value={notes}
                          onChange={(e) => handleUpdateNotes(item.id, e.target.value)}
                          className="w-full text-xs px-2.5 py-1.5 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-slate-400"
                        />

                        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">Qtd:</span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleUpdateQuantity(item.id, -1)}
                                className="w-5 h-5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold text-[10px]"
                              >
                                -
                              </button>
                              <span className="w-6 text-center text-xs font-bold text-slate-900">
                                {quantity}
                              </span>
                              <button
                                onClick={() => handleUpdateQuantity(item.id, 1)}
                                className="w-5 h-5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold text-[10px]"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div className="text-right">
                            {pricing.discountPercent > 0 && (
                              <div className="text-[10px] text-emerald-700 font-semibold">
                                Base: {formatBRL(pricing.basePrice)} (-
                                {formatDiscountPercent(pricing.discountPercent)})
                              </div>
                            )}
                            <div className="text-xs text-slate-500">
                              {formatBRL(pricing.finalUnitPrice)} un.
                            </div>
                            <div className="text-xs font-bold text-slate-900">
                              {formatBRL(subtotal)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectionList.length > 0 && (
                <div className="border border-teal-200 rounded-xl p-3 bg-teal-50/40 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-900">
                    <ClipboardList className="w-4 h-4 text-teal-700" />
                    <span>Vincular itens à Ordem de Serviço:</span>
                  </div>
                  {availableOrders.length > 0 ? (
                    <select
                      value={selectedOrderId}
                      onChange={(e) => setSelectedOrderId(e.target.value)}
                      className="w-full text-xs py-2 px-3 rounded-lg border border-teal-300 bg-white font-medium text-slate-800 focus:ring-2 focus:ring-teal-500"
                    >
                      {availableOrders.map((os) => (
                        <option key={os.id} value={os.id}>
                          OS #{os.order_number} — {os.title} ({os.client?.name || 'Cliente'})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Nenhuma OS aberta no momento. Os itens podem ser copiados ou salvos.
                    </p>
                  )}
                </div>
              )}
            </div>

            {selectionList.length > 0 && (
              <div className="p-5 border-t border-slate-200 bg-slate-50 space-y-3">
                <div className="text-xs space-y-1 text-slate-600 border-b border-slate-200 pb-2">
                  <div className="flex justify-between">
                    <span>Proposto (orçamento):</span>
                    <span className="font-medium">{formatBRL(proposedTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Autorizado (aprovado):</span>
                    <span className="font-medium text-sky-700">{formatBRL(authorizedTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Aplicado (instalado):</span>
                    <span className="font-medium text-emerald-700">{formatBRL(appliedTotal)}</span>
                  </div>
                  {totalDiscountSavings > 0 && (
                    <div className="flex justify-between text-emerald-600 font-semibold pt-1">
                      <span>Desconto comercial aplicado:</span>
                      <span>-{formatBRL(totalDiscountSavings)}</span>
                    </div>
                  )}
                  {modality === 'cash' && savings > totalDiscountSavings && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Economia total à vista:</span>
                      <span>-{formatBRL(savings)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold text-slate-900">Total Selecionado:</span>
                  <span className="text-xl font-extrabold text-teal-800">
                    {formatBRL(totalCurrentModality)}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopySummary}
                    leftIcon={<Copy className="w-3.5 h-3.5" />}
                    className="flex-1"
                  >
                    Copiar Resumo
                  </Button>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveToServiceOrder}
                    isLoading={isSavingToOS}
                    disabled={!selectedOrderId}
                    leftIcon={<Check className="w-3.5 h-3.5" />}
                    className="flex-1"
                  >
                    Vincular à OS
                  </Button>
                </div>

                <div className="text-center">
                  <button
                    onClick={handleClearAll}
                    className="text-[11px] text-slate-400 hover:text-red-600 underline"
                  >
                    Limpar seleção
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
