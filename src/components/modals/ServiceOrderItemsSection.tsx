import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Tag,
  Plus,
  Trash2,
  AlertCircle,
  Search,
  Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import {
  resolveCatalogItemPricing,
  formatDiscountPercent,
} from '../../lib/catalogPricing';
import { isMissingColumnError } from '../../lib/errors';
import { INITIAL_CATALOG_ITEMS } from '../../data/priceCatalogData';
import type {
  PaymentModality,
  OrderItemStatus,
  PriceCatalogItem,
  ServiceOrderItem,
} from '../../types/database';

type CatalogSelectorItem = {
  id: string;
  isDbRecord: boolean;
  code: string;
  category: string;
  subcategory: string | null;
  description: string;
  condition: string;
  price_term: number;
  price_cash: number;
  discount_cash_percent: number | null;
  discount_term_percent: number | null;
};

interface ServiceOrderItemsSectionProps {
  serviceOrderId: string;
  companyId: string;
  equipmentId?: string | null;
}

export const ServiceOrderItemsSection: React.FC<ServiceOrderItemsSectionProps> = ({
  serviceOrderId,
  companyId,
  equipmentId,
}) => {
  const { user, permissions, activeCompany, refreshTenantContext } = useAuthTenant();
  const [items, setItems] = useState<ServiceOrderItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogSelectorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAddingOpen, setIsAddingOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modalidade padrão para novos itens
  const [activeModality, setActiveModality] = useState<PaymentModality>('cash');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');

  const companyDiscountCash = Number(activeCompany?.discount_cash_percent ?? 0);
  const companyDiscountTerm = Number(activeCompany?.discount_term_percent ?? 0);

  const formatBRL = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  // Carregar catálogo ativo real do Supabase (com fallback apenas se tabela vazia)
  const loadCatalog = useCallback(async () => {
    const { data, error } = await supabase
      .from('price_catalog_items')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (!error && data && data.length > 0) {
      setCatalogItems(
        (data as PriceCatalogItem[]).map((row) => ({
          id: row.id,
          isDbRecord: true,
          code: row.code,
          category: row.category,
          subcategory: row.subcategory,
          description: row.description,
          condition: row.condition,
          price_term: Number(row.price_term),
          price_cash: Number(row.price_cash),
          discount_cash_percent:
            row.discount_cash_percent !== null && row.discount_cash_percent !== undefined
              ? Number(row.discount_cash_percent)
              : null,
          discount_term_percent:
            row.discount_term_percent !== null && row.discount_term_percent !== undefined
              ? Number(row.discount_term_percent)
              : null,
        }))
      );
    } else {
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
        }))
      );
    }
  }, [companyId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Atualização automática de preços e descontos via Supabase Realtime + focus
  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`os-catalog-sync-${companyId}-${serviceOrderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'price_catalog_items',
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void loadCatalog();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'companies',
          filter: `id=eq.${companyId}`,
        },
        () => {
          void refreshTenantContext();
          void loadCatalog();
        }
      )
      .subscribe();

    const handleFocus = () => {
      void refreshTenantContext();
      void loadCatalog();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      void supabase.removeChannel(channel);
    };
  }, [companyId, serviceOrderId, loadCatalog, refreshTenantContext]);

  // Carregar itens vinculados à OS
  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('service_order_items')
        .select('*')
        .eq('service_order_id', serviceOrderId)
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setItems(data as ServiceOrderItem[]);
      }
    } catch (e) {
      console.warn('Tabela service_order_items em preparação:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [serviceOrderId, companyId]);

  // Categorias do catálogo carregado
  const categories = useMemo(() => {
    const set = new Set<string>();
    catalogItems.forEach((it) => set.add(it.category));
    return ['Todas', ...Array.from(set).sort()];
  }, [catalogItems]);

  // Filtragem dos itens para o modal de adição
  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.toLowerCase().trim();
    return catalogItems.filter((item) => {
      if (selectedCategory !== 'Todas' && item.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.description.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [catalogItems, catalogSearch, selectedCategory]);

  // Adicionar item à OS
  const handleAddItemToOS = async (catalogItem: CatalogSelectorItem) => {
    setActionError(null);
    const pricing = resolveCatalogItemPricing({
      baseCash: catalogItem.price_cash,
      baseTerm: catalogItem.price_term,
      itemDiscountCash: catalogItem.discount_cash_percent,
      itemDiscountTerm: catalogItem.discount_term_percent,
      companyDiscountCash,
      companyDiscountTerm,
      modality: activeModality,
    });

    const newItemPayload = {
      company_id: companyId,
      service_order_id: serviceOrderId,
      catalog_item_id: catalogItem.isDbRecord ? catalogItem.id : null,
      equipment_id: equipmentId || null,
      item_code: catalogItem.code,
      description: catalogItem.description,
      category: catalogItem.category,
      condition: catalogItem.condition,
      payment_modality: activeModality,
      quantity: 1,
      base_unit_price: pricing.basePrice,
      discount_percent: pricing.discountPercent,
      unit_price: pricing.finalUnitPrice,
      discount_amount: pricing.discountAmountPerUnit,
      total_price: pricing.finalUnitPrice,
      item_status: 'proposed' as OrderItemStatus, // Inicialmente Proposto
      notes: null,
    };

    try {
      let { data, error } = await supabase
        .from('service_order_items')
        .insert(newItemPayload)
        .select()
        .single();

      if (error && isMissingColumnError(error)) {
        const { base_unit_price: _b, discount_percent: _d, ...legacyPayload } = newItemPayload;
        const retry = await supabase
          .from('service_order_items')
          .insert(legacyPayload)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (!error && data) {
        setItems((prev) => [...prev, data as ServiceOrderItem]);
      } else if (error) {
        setActionError(error.message);
      }
    } catch (e) {
      console.warn('Erro ao inserir item na OS:', e);
    }
  };

  // Alternar Status do Item (Proposto -> Autorizado -> Aplicado) com controle de permissão
  const handleToggleStatus = async (item: ServiceOrderItem, newStatus: OrderItemStatus) => {
    setActionError(null);

    // Validação 1: Aprovação é restrita a gestores
    if (newStatus === 'authorized' && !permissions.canApproveOrderItems) {
      setActionError('Aprovação restrita ao gestor da empresa. O técnico pode propor o item ou registrar a aplicação após aprovado.');
      return;
    }

    // Validação 2: Aplicação exige autorização prévia
    if (newStatus === 'applied' && item.item_status !== 'authorized' && !permissions.canApproveOrderItems) {
      setActionError('Esta peça não pode ser marcada como aplicada sem prévia autorização do gestor ou cliente.');
      return;
    }

    try {
      const updatePayload: Partial<ServiceOrderItem> = {
        item_status: newStatus,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === 'authorized') {
        updatePayload.authorized_by = user?.id || null;
        updatePayload.authorized_at = new Date().toISOString();
      } else if (newStatus === 'applied') {
        updatePayload.applied_by = user?.id || null;
        updatePayload.applied_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('service_order_items')
        .update(updatePayload)
        .eq('id', item.id);

      if (error) {
        console.warn('Erro ao atualizar status no Supabase:', error.message);
      }

      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, ...updatePayload } : i))
      );
    } catch (e) {
      console.warn('Erro ao atualizar status:', e);
    }
  };

  // Remover item
  const handleRemoveItem = async (itemId: string) => {
    try {
      await supabase.from('service_order_items').delete().eq('id', itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e) {
      console.warn('Erro ao remover item:', e);
    }
  };

  // Totais
  const totalGeneral = items.reduce((acc, i) => acc + (Number(i.total_price) || 0), 0);
  const totalApplied = items
    .filter((i) => i.item_status === 'applied')
    .reduce((acc, i) => acc + (Number(i.total_price) || 0), 0);
  const totalAuthorized = items
    .filter((i) => i.item_status === 'authorized')
    .reduce((acc, i) => acc + (Number(i.total_price) || 0), 0);
  const totalProposed = items
    .filter((i) => i.item_status === 'proposed')
    .reduce((acc, i) => acc + (Number(i.total_price) || 0), 0);

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
      {/* Cabeçalho da Seção */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-teal-700" />
          <span className="text-xs font-bold text-slate-900 tracking-tight">
            Peças e Serviços da OS ({items.length})
          </span>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
          {items.length > 0 && (
            <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
              Total: {formatBRL(totalGeneral)}
            </span>
          )}
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsAddingOpen(!isAddingOpen)}
          leftIcon={<Plus className="w-3.5 h-3.5 text-teal-600" />}
          className="text-xs"
        >
          {isAddingOpen ? 'Fechar Catálogo' : 'Adicionar Peça'}
        </Button>
      </div>

      {/* Regra Comercial & Classificação */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="w-3.5 h-3.5 text-teal-600" />
          <span>Status do Item:</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">Proposto</span>
          <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-semibold">Autorizado (Gestor/Cliente)</span>
          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">Aplicado</span>
        </div>
        <div className="text-slate-500 text-[10px]">
          {permissions.canApproveOrderItems ? 'Perfil Gestor: Permissão total de aprovação' : 'Perfil Técnico: Proposição e Aplicação'}
        </div>
      </div>

      {/* Alerta de Ação / Validação de Aprovação */}
      {actionError && (
        <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-amber-700 hover:text-amber-900 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Modal/Gaveta de Adição de Peças do Catálogo Oficial */}
      {isAddingOpen && (
        <div className="border border-teal-200 rounded-xl p-3 bg-teal-50/20 space-y-3 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-teal-600" />
              Consultar Catálogo Oficial (130 Itens)
            </span>

            {/* Modalidade */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setActiveModality('cash')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                  activeModality === 'cash'
                    ? 'bg-white text-teal-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                À Vista / 3D
                {companyDiscountCash > 0 ? ` (-${formatDiscountPercent(companyDiscountCash)})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setActiveModality('term')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                  activeModality === 'term'
                    ? 'bg-white text-teal-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Boleto 20/40D
                {companyDiscountTerm > 0 ? ` (-${formatDiscountPercent(companyDiscountTerm)})` : ''}
              </button>
            </div>
          </div>

          {/* Campo de Busca & Categoria */}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Pesquisar por peça, modelo (Prix 3, 4, 5, 6), código..."
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="text-xs py-1.5 px-2 rounded-lg border border-slate-300 bg-white"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Lista rápida de resultados */}
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
            {filteredCatalog.slice(0, 20).map((item) => {
              const pricing = resolveCatalogItemPricing({
                baseCash: item.price_cash,
                baseTerm: item.price_term,
                itemDiscountCash: item.discount_cash_percent,
                itemDiscountTerm: item.discount_term_percent,
                companyDiscountCash,
                companyDiscountTerm,
                modality: activeModality,
              });
              return (
                <div
                  key={item.id}
                  className="p-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="font-mono text-[10px] bg-slate-100 px-1 rounded text-slate-700 font-bold">
                        {item.code}
                      </span>
                      <span className="text-[10px] text-slate-500">{item.category}</span>
                      <span className="text-[10px] px-1 rounded font-semibold bg-emerald-50 text-emerald-700">
                        {item.condition}
                      </span>
                      {pricing.discountPercent > 0 && (
                        <span className="text-[10px] px-1.5 rounded font-bold bg-emerald-100 text-emerald-800">
                          -{formatDiscountPercent(pricing.discountPercent)}
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-slate-900 truncate">
                      {item.description}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      {pricing.discountPercent > 0 && (
                        <div className="text-[10px] text-slate-400 line-through">
                          {formatBRL(pricing.basePrice)}
                        </div>
                      )}
                      <span className="font-bold text-slate-900">
                        {formatBRL(pricing.finalUnitPrice)}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddItemToOS(item)}
                      className="py-1 px-2 text-xs border-teal-500 text-teal-700 hover:bg-teal-50"
                    >
                      Inserir
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lista de Itens Vinculados */}
      {items.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-xs">
          Nenhuma peça ou serviço vinculado a esta OS ainda.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {items.map((item) => {
            const isApplied = item.item_status === 'applied';
            const isAuthorized = item.item_status === 'authorized';

            return (
              <div key={item.id} className="p-3 bg-white flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono font-bold bg-slate-100 px-1 rounded text-slate-700">
                        {item.item_code}
                      </span>
                      {item.category && (
                        <span className="text-[10px] text-slate-500">{item.category}</span>
                      )}
                      <span className="text-[10px] px-1 rounded font-medium bg-slate-100 text-slate-600">
                        {item.payment_modality === 'cash' ? 'À Vista / 3D' : 'Boleto 20/40D'}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900">
                      {item.description}
                    </div>
                  </div>

                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    className="text-slate-400 hover:text-red-600 p-1"
                    title="Excluir peça"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Status Toggle & Valores */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-50 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">Status:</span>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(item, 'proposed')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        item.item_status === 'proposed'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Proposto
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(item, 'authorized')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        isAuthorized
                          ? 'bg-sky-100 text-sky-900 border-sky-300'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Autorizado
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(item, 'applied')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        isApplied
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Aplicado
                    </button>
                  </div>

                  <div className="text-right">
                    {Number(item.discount_percent || 0) > 0 && (
                      <div className="text-[10px] text-emerald-700 font-semibold">
                        Base: {formatBRL(Number(item.base_unit_price ?? item.unit_price))} (-
                        {formatDiscountPercent(item.discount_percent)})
                      </div>
                    )}
                    <div className="font-bold text-slate-900 text-xs">
                      {item.quantity}x {formatBRL(item.unit_price)} = {formatBRL(item.total_price)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resumo Financeiro da OS */}
      {items.length > 0 && (
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3 text-slate-600">
            <span>Proposto: <strong>{formatBRL(totalProposed)}</strong></span>
            <span>Autorizado: <strong className="text-sky-700">{formatBRL(totalAuthorized)}</strong></span>
            <span>Aplicado: <strong className="text-emerald-700">{formatBRL(totalApplied)}</strong></span>
          </div>
          <div className="text-sm font-extrabold text-teal-800">
            Total da OS: {formatBRL(totalGeneral)}
          </div>
        </div>
      )}
    </div>
  );
};
