import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  User,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import type { Equipment, ServiceOrder } from '../../types/database';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { OSPriorityBadge, OSStatusBadge } from '../ui/Badge';

interface EquipmentHistoryModalProps {
  equipment: Equipment | null;
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder?: (orderId: string) => void;
}

export const EquipmentHistoryModal: React.FC<EquipmentHistoryModalProps> = ({
  equipment,
  isOpen,
  onClose,
  onSelectOrder,
}) => {
  const { activeCompany } = useAuthTenant();
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !equipment || !activeCompany) {
      setOrders([]);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    supabase
      .from('service_orders')
      .select(`
        *,
        primary_technician:technicians(id, full_name, phone)
      `)
      .eq('company_id', activeCompany.id)
      .eq('equipment_id', equipment.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: qErr }) => {
        if (!isMounted) return;
        setLoading(false);
        if (qErr) {
          setError('Não foi possível carregar o histórico de atendimentos.');
        } else {
          setOrders((data as unknown as ServiceOrder[]) || []);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, equipment, activeCompany]);

  if (!equipment) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Histórico da Balança: ${equipment.brand} ${equipment.model}`}
      subtitle={`Série: ${equipment.serial_number} • Cliente: ${equipment.client?.trade_name || equipment.client?.name || 'Cliente'}`}
      maxWidthClass="max-w-3xl"
      footer={
        <Button variant="outline" onClick={onClose}>
          Fechar Histórico
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Ficha Resumida do Equipamento */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Tipo / Categoria</span>
            <span className="font-semibold text-slate-800">{equipment.equipment_type}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Capacidade / Divisão</span>
            <span className="font-semibold text-slate-800">
              {equipment.capacity_label || 'N/I'} {equipment.division_label ? `(e=${equipment.division_label})` : ''}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Portaria Inmetro</span>
            <span className="font-semibold text-teal-800">{equipment.inmetro_ordinance || 'Não informada'}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Último Lacre</span>
            <span className="font-semibold text-slate-800 font-mono">{equipment.seal_number || 'Sem lacre'}</span>
          </div>
        </div>

        {/* Linha do Tempo das Ordens de Serviço */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-teal-600" />
            Atendimentos e Calibrações Anteriores ({orders.length})
          </h4>

          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Carregando histórico metrológico...
            </div>
          ) : error ? (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : orders.length === 0 ? (
            <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
              Nenhuma ordem de serviço foi registrada para esta balança até o momento.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {orders.map((os) => (
                <div
                  key={os.id}
                  className="bg-white border border-slate-200 rounded-xl p-3.5 hover:border-teal-500 hover:shadow-xs transition-all space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                          OS #{os.order_number}
                        </span>
                        <OSStatusBadge status={os.status} />
                        <OSPriorityBadge priority={os.priority} />
                      </div>
                      <h5 className="text-xs font-bold text-slate-900 mt-1">{os.title}</h5>
                    </div>

                    <div className="text-[11px] text-slate-400 flex items-center gap-1 shrink-0">
                      <Calendar className="w-3 h-3" />
                      <span>
                        {new Date(os.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>

                  {os.reported_issue && (
                    <p className="text-xs text-slate-600 bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                      <strong>Defeito relatado:</strong> {os.reported_issue}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>Técnico: <strong>{os.primary_technician?.full_name || 'Não atribuído'}</strong></span>
                    </span>

                    {onSelectOrder && (
                      <button
                        onClick={() => {
                          onClose();
                          onSelectOrder(os.id);
                        }}
                        className="text-teal-700 hover:text-teal-900 font-semibold text-[11px] inline-flex items-center gap-1"
                      >
                        <span>Ver detalhes da OS</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
