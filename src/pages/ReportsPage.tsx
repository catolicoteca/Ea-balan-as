import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthTenant } from '../contexts/AuthTenantContext';
import { translateSupabaseError } from '../lib/errors';
import type { Equipment, OSType, ServiceOrder } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { OS_STATUS_META, OS_TYPE_LABELS } from '../components/ui/Badge';
import { AlertBanner, EmptyState } from '../components/ui/EmptyState';

export const ReportsPage: React.FC = () => {
  const { activeCompany, permissions } = useAuthTenant();

  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReportData = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);

    const [osRes, eqRes] = await Promise.all([
      supabase
        .from('service_orders')
        .select(
          `
          *,
          client:clients(id, name, trade_name),
          primary_technician:technicians!fk_os_primary_technician_tenant(id, full_name)
        `
        )
        .eq('company_id', activeCompany.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('equipments')
        .select('*, client:clients(id, name, trade_name)')
        .eq('company_id', activeCompany.id)
        .not('next_calibration_date', 'is', null)
        .order('next_calibration_date', { ascending: true }),
    ]);

    if (osRes.error) {
      setError(translateSupabaseError(osRes.error));
    } else {
      setOrders((osRes.data as unknown as ServiceOrder[]) ?? []);
    }

    setEquipments((eqRes.data as unknown as Equipment[]) ?? []);
    setLoading(false);
  }, [activeCompany]);

  useEffect(() => {
    void loadReportData();
  }, [loadReportData]);

  const byType = useMemo(() => {
    const map: Record<OSType, number> = {
      corrective: 0,
      preventive: 0,
      calibration: 0,
      installation: 0,
      inspection: 0,
    };
    for (const o of orders) {
      map[o.order_type] = (map[o.order_type] ?? 0) + 1;
    }
    return Object.entries(map) as Array<[OSType, number]>;
  }, [orders]);

  const byTechnician = useMemo(() => {
    const map = new Map<string, { name: string; total: number; completed: number }>();
    for (const o of orders) {
      const key = o.primary_technician?.id ?? 'unassigned';
      const label = o.primary_technician?.full_name ?? 'Sem técnico atribuído';
      const cur = map.get(key) ?? { name: label, total: 0, completed: 0 };
      cur.total += 1;
      if (o.status === 'completed') cur.completed += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [orders]);

  const handleExportCSV = () => {
    if (!orders.length) return;
    const headers = [
      'Numero_OS',
      'Status',
      'Tipo',
      'Prioridade',
      'Cliente',
      'Tecnico',
      'Titulo',
      'Criada_Em',
    ];
    const rows = orders.map((o) => [
      o.order_number,
      OS_STATUS_META[o.status].label,
      OS_TYPE_LABELS[o.order_type],
      o.priority,
      (o.client?.trade_name || o.client?.name || '').replace(/;/g, ','),
      (o.primary_technician?.full_name || '').replace(/;/g, ','),
      o.title.replace(/;/g, ','),
      new Date(o.created_at).toLocaleString('pt-BR'),
    ]);

    const csvContent =
      '\uFEFF' +
      [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-os-${activeCompany?.slug || 'empresa'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!permissions.canViewReports) {
    return (
      <AlertBanner
        variant="warning"
        title="Acesso Restrito"
        message="Os relatórios consolidados da empresa são exclusivos para Gestores e Administradores."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Relatórios Gerenciais
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Consolidação real de produtividade por técnico, modalidade de serviço e vencimentos de calibração.
          </p>
        </div>

        <Button
          variant="outline"
          disabled={orders.length === 0}
          onClick={handleExportCSV}
          leftIcon={<Download className="w-4 h-4" />}
        >
          Exportar CSV Real ({orders.length})
        </Button>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {loading ? (
        <Card>
          <div className="py-12 text-center text-xs text-slate-400">
            Consolidando métricas reais no banco...
          </div>
        </Card>
      ) : orders.length === 0 && equipments.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="w-5 h-5" />}
            title="Ainda não há registros suficientes para relatórios"
            description="Nenhum dado simulado é exibido. Cadastre ordens de serviço e balanças para visualizar indicadores analíticos e exportar planilhas."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card
            title="Ordens de Serviço por Natureza Técnica"
            subtitle="Distribuição acumulada na empresa ativa"
          >
            <div className="space-y-3">
              {byType.map(([typeKey, qty]) => {
                const pct =
                  orders.length > 0 ? Math.round((qty / orders.length) * 100) : 0;
                return (
                  <div key={typeKey} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700">
                        {OS_TYPE_LABELS[typeKey]}
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {qty} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: 'var(--brand-primary, #0D9488)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            title="Carga e Conclusão por Técnico"
            subtitle="Ordens atribuídas x concluídas"
          >
            {byTechnician.length === 0 ? (
              <p className="text-xs text-slate-400">Sem OS registradas.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {byTechnician.map((row) => (
                  <div
                    key={row.name}
                    className="py-2.5 flex items-center justify-between"
                  >
                    <span className="font-medium text-slate-800">{row.name}</span>
                    <span className="tabular-nums text-slate-600">
                      Total: <strong className="text-slate-900">{row.total}</strong> •{' '}
                      Concluídas:{' '}
                      <strong className="text-emerald-700">{row.completed}</strong>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            className="lg:col-span-2"
            title="Controle de Vencimento de Calibração de Balanças"
            subtitle="Equipamentos com data de próxima calibração programada"
          >
            {equipments.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nenhuma balança possui data de próxima calibração informada até o momento.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {equipments.slice(0, 10).map((eq) => {
                  const due = new Date(`${eq.next_calibration_date}T12:00:00`);
                  const isOverdue = due.getTime() < Date.now();
                  return (
                    <div
                      key={eq.id}
                      className="py-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-slate-900">
                          {eq.brand} {eq.model}
                        </span>{' '}
                        <span className="font-mono text-teal-700">
                          (S/N: {eq.serial_number})
                        </span>
                        <span className="text-slate-500 ml-2">
                          • {eq.client?.trade_name || eq.client?.name}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium ${
                          isOverdue
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-sky-50 text-sky-800 border border-sky-200'
                        }`}
                      >
                        {isOverdue && <AlertTriangle className="w-3 h-3" />}
                        {isOverdue ? 'Calibração vencida: ' : 'Próxima: '}
                        {due.toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};
