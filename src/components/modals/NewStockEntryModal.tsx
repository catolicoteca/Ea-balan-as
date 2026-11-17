import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { InputField, SelectField } from '../ui/FormField';
import { supabase } from '../../lib/supabase';
import { createStockEntry } from '../../lib/stock';
import type { StockLocation, PriceCatalogItem } from '../../types/database';

interface NewStockEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  companyId: string;
  locations: StockLocation[];
}

export const NewStockEntryModal: React.FC<NewStockEntryModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  companyId,
  locations,
}) => {
  const [locationId, setLocationId] = useState('');
  const [catalogItems, setCatalogItems] = useState<PriceCatalogItem[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0.00');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (locations.length > 0 && !locationId) {
      // Prioriza Almoxarifado Central
      const central = locations.find((l) => l.location_type === 'central');
      setLocationId(central ? central.id : locations[0].id);
    }
  }, [locations, locationId]);

  useEffect(() => {
    if (!isOpen || !companyId) return;
    const loadCatalog = async () => {
      const { data } = await supabase
        .from('price_catalog_items')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('description', { ascending: true })
        .limit(100);

      if (data) setCatalogItems(data as PriceCatalogItem[]);
    };
    void loadCatalog();
  }, [isOpen, companyId]);

  const handleSelectCatalogItem = (catId: string) => {
    setSelectedCatalogId(catId);
    if (!catId) return;
    const found = catalogItems.find((c) => c.id === catId);
    if (found) {
      setItemCode(found.code);
      setName(found.description);
      setCategory(found.category || '');
      // Sugere custo aproximado se houver ou mantém padrão
      if (Number(found.price_cash) > 0) {
        setUnitCost((Number(found.price_cash) * 0.6).toFixed(2));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numQty = Number(quantity);
    const numCost = Number(unitCost);

    if (!locationId) {
      setError('Selecione o local de destino no estoque.');
      return;
    }
    if (!itemCode.trim()) {
      setError('Informe o código da peça ou item.');
      return;
    }
    if (!name.trim()) {
      setError('Informe a descrição/nome do item.');
      return;
    }
    if (isNaN(numQty) || numQty <= 0) {
      setError('A quantidade deve ser um número maior que zero.');
      return;
    }
    if (isNaN(numCost) || numCost < 0) {
      setError('O custo unitário deve ser um número válido.');
      return;
    }

    setLoading(true);
    try {
      await createStockEntry(companyId, {
        locationId,
        catalogItemId: selectedCatalogId || null,
        itemCode,
        name,
        category: category || undefined,
        quantity: numQty,
        unitCost: numCost,
        invoiceNumber: invoiceNumber || undefined,
        notes: notes || undefined,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao registrar entrada no estoque.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nova Entrada de Peças / Mercadorias"
      subtitle="Adicionar itens ao estoque central ou almoxarifado"
      maxWidthClass="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <SelectField
          label="Local de Destino no Estoque"
          required
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name} ({loc.location_type === 'central' ? 'Central' : loc.location_type === 'technician' ? 'Técnico' : 'Geral'})
            </option>
          ))}
        </SelectField>

        {catalogItems.length > 0 && (
          <SelectField
            label="Buscar no Catálogo de Peças (Opcional)"
            value={selectedCatalogId}
            onChange={(e) => handleSelectCatalogItem(e.target.value)}
          >
            <option value="">-- Inserir Manualmente ou Selecionar do Catálogo --</option>
            {catalogItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} - {c.description} ({c.category})
              </option>
            ))}
          </SelectField>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="Código do Item / SKU"
            required
            placeholder="Ex: CEL-500, PLACA-MA"
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
          />

          <InputField
            label="Categoria"
            placeholder="Ex: Células de Carga, Placas"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>

        <InputField
          label="Nome / Descrição do Item"
          required
          placeholder="Ex: Célula de Carga 500kg Toledo com Cabo 5m"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <InputField
            label="Quantidade"
            type="number"
            step="1"
            min="1"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />

          <InputField
            label="Custo Unitário (R$)"
            type="number"
            step="0.01"
            min="0"
            required
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />

          <InputField
            label="Nº da Nota Fiscal"
            placeholder="NF-e"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        </div>

        <InputField
          label="Observações / Fornecedor"
          placeholder="Ex: Compra Direta Toledo, Lote #4412"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            type="submit"
            isLoading={loading}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            Confirmar Entrada
          </Button>
        </div>
      </form>
    </Modal>
  );
};
