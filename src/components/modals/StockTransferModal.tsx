import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { InputField, SelectField } from '../ui/FormField';
import { transferStock } from '../../lib/stock';
import type { StockLocation, InventoryItem } from '../../types/database';

interface StockTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  companyId: string;
  locations: StockLocation[];
  inventoryItems: InventoryItem[];
}

export const StockTransferModal: React.FC<StockTransferModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  companyId,
  locations,
  inventoryItems,
}) => {
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destLocationId, setDestLocationId] = useState('');
  const [selectedItemCode, setSelectedItemCode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Define Central como origem padrão e o 1º técnico como destino
  useEffect(() => {
    if (locations.length > 0) {
      const central = locations.find((l) => l.location_type === 'central');
      const techLoc = locations.find((l) => l.location_type === 'technician');
      if (central && !sourceLocationId) setSourceLocationId(central.id);
      if (techLoc && !destLocationId) setDestLocationId(techLoc.id);
    }
  }, [locations, sourceLocationId, destLocationId]);

  // Itens disponíveis no local de origem selecionado com saldo > 0
  const availableItemsAtSource = inventoryItems.filter(
    (item) => item.location_id === sourceLocationId && Number(item.quantity) > 0
  );

  const selectedItem = availableItemsAtSource.find(
    (i) => i.item_code.toLowerCase() === selectedItemCode.toLowerCase()
  );

  const maxQty = selectedItem ? Number(selectedItem.quantity) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numQty = Number(quantity);

    if (!sourceLocationId) {
      setError('Selecione o local de origem.');
      return;
    }
    if (!destLocationId) {
      setError('Selecione o local de destino (ex: Veículo do Técnico).');
      return;
    }
    if (sourceLocationId === destLocationId) {
      setError('A origem e o destino não podem ser o mesmo local.');
      return;
    }
    if (!selectedItemCode) {
      setError('Selecione a peça a transferir.');
      return;
    }
    if (isNaN(numQty) || numQty <= 0) {
      setError('A quantidade deve ser maior que zero.');
      return;
    }
    if (numQty > maxQty) {
      setError(`Quantidade solicitada (${numQty}) excede o saldo disponível na origem (${maxQty}).`);
      return;
    }

    setLoading(true);
    try {
      await transferStock(companyId, {
        sourceLocationId,
        destLocationId,
        itemCode: selectedItemCode,
        quantity: numQty,
        notes: notes || undefined,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao realizar transferência de estoque.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Transferência de Estoque"
      subtitle="Transferir peças entre o Almoxarifado Central e o Veículo do Técnico"
      maxWidthClass="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Origem (De onde sai)"
            required
            value={sourceLocationId}
            onChange={(e) => {
              setSourceLocationId(e.target.value);
              setSelectedItemCode('');
            }}
          >
            <option value="">-- Selecionar Origem --</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Destino (Para onde vai)"
            required
            value={destLocationId}
            onChange={(e) => setDestLocationId(e.target.value)}
          >
            <option value="">-- Selecionar Destino --</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </SelectField>
        </div>

        <SelectField
          label="Peça / Item a Transferir"
          required
          value={selectedItemCode}
          onChange={(e) => setSelectedItemCode(e.target.value)}
        >
          <option value="">-- Selecione uma peça com saldo na origem --</option>
          {availableItemsAtSource.map((item) => (
            <option key={item.id} value={item.item_code}>
              {item.item_code} - {item.name} (Disponível: {item.quantity} {item.unit_of_measure})
            </option>
          ))}
        </SelectField>

        {selectedItem && (
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-800 flex justify-between items-center">
            <span>
              Saldo atual na origem: <strong>{selectedItem.quantity} {selectedItem.unit_of_measure}</strong>
            </span>
            <span>
              Custo Médio: <strong>R$ {Number(selectedItem.unit_cost).toFixed(2)}</strong>
            </span>
          </div>
        )}

        <InputField
          label="Quantidade a Transferir"
          type="number"
          step="1"
          min="1"
          max={maxQty > 0 ? maxQty : undefined}
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />

        <InputField
          label="Motivo / Observações"
          placeholder="Ex: Carga matinal para atendimento em campo"
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
            leftIcon={<ArrowRightLeft className="w-4 h-4" />}
          >
            Confirmar Transferência
          </Button>
        </div>
      </form>
    </Modal>
  );
};
