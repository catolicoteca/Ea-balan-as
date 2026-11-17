import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Boxes,
  Plus,
  ArrowRightLeft,
  AlertTriangle,
  Search,
  Package,
  Warehouse,
  Truck,
  RotateCcw,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { Button } from '../components/ui/Button';
import {
  fetchStockLocations,
  fetchInventoryItems,
  fetchStockMovements,
  fetchLowStockAlerts,
} from '../lib/stock';
import { NewStockEntryModal } from '../components/modals/NewStockEntryModal';
import { StockTransferModal } from '../components/modals/StockTransferModal';
import type {
  StockLocation,
  InventoryItem,
  StockMovement,
  StockAlert,
} from '../types/database';

export const InventoryPage: React.FC = () => {
  const { activeCompany, effectiveRole } = useAuthTenant();

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'inventory' | 'movements' | 'alerts'>('inventory');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  const canManageStock =
    effectiveRole === 'manager' ||
    effectiveRole === 'administrator' ||
    effectiveRole === 'stock_manager' ||
    effectiveRole === 'platform_admin';

  const loadStockData = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const [locs, invItems, movs, lowAlerts] = await Promise.all([
        fetchStockLocations(activeCompany.id),
        fetchInventoryItems(activeCompany.id),
        fetchStockMovements(activeCompany.id, 50),
        fetchLowStockAlerts(activeCompany.id),
      ]);

      setLocations(locs);
      setItems(invItems);
      setMovements(movs);
      setAlerts(lowAlerts);
    } catch (err) {
      console.warn('Erro ao carregar dados de estoque:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    void loadStockData();
  }, [loadStockData]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedLocationId !== 'all' && item.location_id !== selectedLocationId) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.item_code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.category && item.category.toLowerCase().includes(q))
      );
    });
  }, [items, selectedLocationId, search]);

  const totalStockValue = useMemo(() => {
    return items.reduce((acc, curr) => acc + Number(curr.quantity) * Number(curr.unit_cost), 0);
  }, [items]);

  const formatBRL = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0B2545] tracking-tight flex items-center gap-2.5">
            <Boxes className="w-7 h-7 text-[#0D9488]" />
            Controle de Estoque & Peças
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Gestão de almoxarifado central, estoques móveis dos técnicos e baixa automática de OS.
          </p>
        </div>

        {canManageStock && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArrowRightLeft className="w-4 h-4 text-[#0D9488]" />}
              onClick={() => setIsTransferModalOpen(true)}
            >
              Transferir para Técnico
            </Button>
            <Button
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
              className="bg-[#0D9488] hover:bg-[#0f766e] text-white"
              onClick={() => setIsEntryModalOpen(true)}
            >
              Nova Entrada de Peças
            </Button>
          </div>
        )}
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-[#0D9488]">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Itens no Catálogo</p>
            <p className="text-xl font-extrabold text-slate-900">{items.length}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Valor Total em Estoque</p>
            <p className="text-xl font-extrabold text-slate-900">{formatBRL(totalStockValue)}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700">
            <Warehouse className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Locais Ativos</p>
            <p className="text-xl font-extrabold text-slate-900">{locations.length}</p>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('alerts')}
          className={`cursor-pointer bg-white p-4 rounded-xl border shadow-sm flex items-center gap-3 transition-colors ${
            alerts.length > 0
              ? 'border-red-300 bg-red-50/30 hover:bg-red-50/60'
              : 'border-slate-200/80'
          }`}
        >
          <div
            className={`w-12 h-12 rounded-xl border flex items-center justify-center ${
              alerts.length > 0
                ? 'bg-red-100 border-red-200 text-red-700'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}
          >
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Estoque Baixo (Reposição)</p>
            <p
              className={`text-xl font-extrabold ${
                alerts.length > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {alerts.length} {alerts.length === 1 ? 'item crítico' : 'itens críticos'}
            </p>
          </div>
        </div>
      </div>

      {/* Alerta de Estoque Crítico Banner */}
      {alerts.length > 0 && activeTab !== 'alerts' && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Atenção: <strong>{alerts.length} itens</strong> estão abaixo da quantidade mínima de
              segurança.
            </span>
          </div>
          <button
            onClick={() => setActiveTab('alerts')}
            className="font-bold underline text-amber-800 hover:text-amber-950"
          >
            Ver Alertas
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'inventory'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Package className="w-4 h-4" />
          Saldos em Estoque ({filteredItems.length})
        </button>

        <button
          onClick={() => setActiveTab('movements')}
          className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'movements'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          Histórico de Movimentações
        </button>

        <button
          onClick={() => setActiveTab('alerts')}
          className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'alerts'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          Reposição Necessária ({alerts.length})
        </button>
      </div>

      {/* Conteúdo Aba: SALDOS EM ESTOQUE */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Filtros e Busca */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por código, nome ou categoria..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Local:</span>
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-[#0D9488] bg-white font-medium"
              >
                <option value="all">Todos os Locais ({locations.length})</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.location_type === 'central' ? 'Central' : 'Técnico'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tabela de Itens */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Código / SKU</th>
                    <th className="py-3 px-4">Descrição da Peça</th>
                    <th className="py-3 px-4">Localização</th>
                    <th className="py-3 px-4 text-center">Saldo Atual</th>
                    <th className="py-3 px-4 text-center">Mínimo</th>
                    <th className="py-3 px-4 text-right">Custo Médio</th>
                    <th className="py-3 px-4 text-right">Valor Total</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Carregando itens do estoque...
                      </td>
                    </tr>
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Nenhum item encontrado no estoque para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const isLow = Number(item.quantity) <= Number(item.min_quantity);
                      const isOut = Number(item.quantity) <= 0;
                      const totalItemValue = Number(item.quantity) * Number(item.unit_cost);

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">
                            {item.item_code}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900">
                            <div>{item.name}</div>
                            {item.category && (
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                                {item.category}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600 flex items-center gap-1.5">
                            {item.location?.location_type === 'technician' ? (
                              <Truck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            ) : (
                              <Warehouse className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                            )}
                            <span>{item.location?.name || 'Local'}</span>
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-slate-900">
                            {item.quantity} {item.unit_of_measure}
                          </td>
                          <td className="py-3 px-4 text-center text-slate-500">
                            {item.min_quantity} {item.unit_of_measure}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-700">
                            {formatBRL(Number(item.unit_cost))}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-900">
                            {formatBRL(totalItemValue)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {isOut ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                                ESGOTADO
                              </span>
                            ) : isLow ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                CRÍTICO
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">
                                NORMAL
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo Aba: HISTÓRICO DE MOVIMENTAÇÕES */}
      {activeTab === 'movements' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Data / Hora</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Peça / SKU</th>
                  <th className="py-3 px-4 text-center">Quantidade</th>
                  <th className="py-3 px-4">Origem / Destino</th>
                  <th className="py-3 px-4">Referência / OS</th>
                  <th className="py-3 px-4">Observações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Nenhuma movimentação registrada no histórico.
                    </td>
                  </tr>
                ) : (
                  movements.map((mov) => {
                    const isEntry = mov.movement_type === 'entry';
                    const isConsumption = mov.movement_type === 'consumption';
                    const isTransfer =
                      mov.movement_type === 'transfer_out' || mov.movement_type === 'transfer_in';

                    return (
                      <tr key={mov.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {new Date(mov.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-3 px-4">
                          {isEntry && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              ENTRADA
                            </span>
                          )}
                          {isConsumption && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                              BAIXA POR OS
                            </span>
                          )}
                          {isTransfer && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                              {mov.movement_type === 'transfer_out'
                                ? 'TRANSF. SAÍDA'
                                : 'TRANSF. ENTRADA'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {mov.item_code}
                        </td>
                        <td className="py-3 px-4 text-center font-extrabold text-slate-900">
                          {mov.quantity}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {mov.source_location?.name && (
                            <span>De: {mov.source_location.name}</span>
                          )}
                          {mov.destination_location?.name && (
                            <span>Para: {mov.destination_location.name}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {mov.service_order_id ? (
                            <span className="text-[#0D9488]">OS #{mov.service_order_id.slice(0, 8)}</span>
                          ) : mov.invoice_number ? (
                            <span>NF: {mov.invoice_number}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500 max-w-xs truncate">
                          {mov.notes || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conteúdo Aba: ALERTAS DE REPOSIÇÃO */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900">
            <h3 className="font-bold text-sm mb-1 text-red-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Peças Críticas Abaixo do Estoque Mínimo
            </h3>
            <p className="text-red-700">
              Os itens listados abaixo atingiram ou ultrapassaram a margem de segurança e exigem pedido
              de compra ou reposição urgente.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Código</th>
                  <th className="py-3 px-4">Descrição do Item</th>
                  <th className="py-3 px-4">Local</th>
                  <th className="py-3 px-4 text-center">Saldo Atual</th>
                  <th className="py-3 px-4 text-center">Mínimo Exigido</th>
                  <th className="py-3 px-4 text-right">Custo Estimado</th>
                  <th className="py-3 px-4 text-center">Ação Recomendada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-teal-700 font-medium">
                      Parabéns! Todos os itens do estoque estão com saldo acima do mínimo.
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => (
                    <tr key={alert.item_id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono font-bold text-red-700">
                        {alert.item_code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {alert.item_name}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{alert.location_name}</td>
                      <td className="py-3 px-4 text-center font-bold text-red-700">
                        {alert.current_quantity}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500">
                        {alert.min_quantity}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-700">
                        {formatBRL(Number(alert.unit_cost))}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[11px] h-7 px-2.5 border-teal-600 text-teal-700 hover:bg-teal-50"
                          onClick={() => setIsEntryModalOpen(true)}
                        >
                          Registrar Entrada
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modais */}
      {isEntryModalOpen && (
        <NewStockEntryModal
          isOpen={isEntryModalOpen}
          onClose={() => setIsEntryModalOpen(false)}
          onSuccess={() => void loadStockData()}
          companyId={activeCompany?.id || ''}
          locations={locations}
        />
      )}

      {isTransferModalOpen && (
        <StockTransferModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          onSuccess={() => void loadStockData()}
          companyId={activeCompany?.id || ''}
          locations={locations}
          inventoryItems={items}
        />
      )}
    </div>
  );
};
