import React, { useEffect, useState } from 'react';
import {
  Scale,
  ClipboardList,
  Calendar,
  User,
  AlertCircle,
  ExternalLink,
  MapPin,
  Plus,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import type { Client, Equipment, ServiceOrder } from '../../types/database';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { OSPriorityBadge, OSStatusBadge, EquipmentStatusBadge } from '../ui/Badge';

interface ClientHistoryModalProps {
  client: Client | null;
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder?: (orderId: string) => void;
  onNewOrderForClient?: (clientId: string) => void;
}

export const ClientHistoryModal: React.FC<ClientHistoryModalProps> = ({
  client,
  isOpen,
  onClose,
  onSelectOrder,
  onNewOrderForClient,
}) => {
  const { activeCompany } = useAuthTenant();
  const [activeTab, setActiveTab] = useState<'equipments' | 'orders'>('equipments');
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !client || !activeCompany) {
      setEquipments([]);
      setOrders([]);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    Promise.all([
      supabase
        .from('equipments')
        .select('*, unit:client_units(id, unit_name, city, state)')
        .eq('company_id', activeCompany.id)
        .eq('client_id', client.id)
        .order('model', { ascending: true }),
      supabase
        .from('service_orders')
        .select(`
          *,
          equipment:equipments(id, brand, model, serial_number),
          primary_technician:technicians(id, full_name)
        `)
        .eq('company_id', activeCompany.id)
        .eq('client_id', client.id)
        .order('created_at', { ascending: false }),
    ]).then(([eqRes, osRes]) => {
      if (!isMounted) return;
      setLoading(false);
      if (eqRes.error || osRes.error) {
        setError('Erro ao carregar dados do cliente.');
      } else {
        setEquipments((eqRes.data as unknown as Equipment[]) || []);
        setOrders((osRes.data as unknown as ServiceOrder[]) || []);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, client, activeCompany]);

  if (!client) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={client.trade_name || client.name}
      subtitle={`CNPJ/CPF: ${client.document_number || 'Não informado'} • Contato: ${client.phone || client.contact_name || 'Geral'}`}
      maxWidthClass="max-w-4xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {onNewOrderForClient && (
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                  onNewOrderForClient(client.id);
                }}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Abrir Nova OS para este Cliente
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Abas Superiores */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('equipments')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'equipments'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>Balanças do Cliente ({equipments.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'orders'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>Histórico de Ordens de Serviço ({orders.length})</span>
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Carregando informações do cliente...
          </div>
        ) : activeTab === 'equipments' ? (
          <div className="space-y-2.5">
            {equipments.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                Nenhuma balança cadastrada para este cliente até o momento.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {equipments.map((eq) => (
                  <div
                    key={eq.id}
                    className="bg-white border border-slate-200 rounded-xl p-3.5 hover:border-teal-500 hover:shadow-xs transition-all space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-teal-800">
                          {eq.equipment_type}
                        </div>
                        <h5 className="text-sm font-bold text-slate-900">
                          {eq.brand} {eq.model}
                        </h5>
                      </div>
                      <EquipmentStatusBadge status={eq.status} />
                    </div>

                    <div className="text-xs text-slate-600 space-y-0.5">
                      <div>
                        <span className="text-slate-400">Nº de Série:</span> <strong className="font-mono text-slate-800">{eq.serial_number}</strong>
                      </div>
                      {eq.inmetro_ordinance && (
                        <div>
                          <span className="text-slate-400">Portaria Inmetro:</span> <strong>{eq.inmetro_ordinance}</strong>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-400">Capacidade:</span> <strong>{eq.capacity_label || 'N/I'}</strong> {eq.division_label ? `(e=${eq.division_label})` : ''}
                      </div>
                      {eq.unit && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 pt-1">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{eq.unit.unit_name} ({eq.unit.city}/{eq.unit.state})</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {orders.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                Nenhuma ordem de serviço registrada para este cliente.
              </div>
            ) : (
              orders.map((os) => (
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
                      <span>{new Date(os.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>

                  {os.equipment && (
                    <div className="text-xs text-slate-600 flex items-center gap-1">
                      <Scale className="w-3.5 h-3.5 text-teal-600" />
                      <span>Balança: <strong>{os.equipment.brand} {os.equipment.model}</strong> ({os.equipment.serial_number})</span>
                    </div>
                  )}

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
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
