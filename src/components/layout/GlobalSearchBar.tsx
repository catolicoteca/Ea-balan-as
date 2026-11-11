import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Building2,
  Scale,
  ClipboardList,
  Loader2,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthTenant } from '../../contexts/AuthTenantContext';
import type { GlobalSearchResults } from '../../types/database';
import { OSStatusBadge } from '../ui/Badge';

interface GlobalSearchBarProps {
  placeholder?: string;
  onSelectServiceOrder?: (osId: string) => void;
}

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({
  placeholder = 'Pesquisar clientes, equipamentos (série/modelo) ou nº da OS...',
  onSelectServiceOrder,
}) => {
  const { activeCompany, schemaMissing } = useAuthTenant();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GlobalSearchResults>({
    clients: [],
    equipments: [],
    serviceOrders: [],
  });

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!activeCompany || schemaMissing || term.length < 2) {
      setResults({ clients: [], equipments: [], serviceOrders: [] });
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      const safe = term.replace(/[%_]/g, '');
      const pattern = `%${safe}%`;

      const [clientsRes, equipsRes, osRes] = await Promise.all([
        supabase
          .from('clients')
          .select('id, name, trade_name, document_number, phone')
          .eq('company_id', activeCompany.id)
          .or(
            `name.ilike.${pattern},trade_name.ilike.${pattern},document_number.ilike.${pattern}`
          )
          .limit(5),
        supabase
          .from('equipments')
          .select(
            'id, brand, model, serial_number, capacity_label, client:clients(name)'
          )
          .eq('company_id', activeCompany.id)
          .or(
            `serial_number.ilike.${pattern},brand.ilike.${pattern},model.ilike.${pattern},asset_tag.ilike.${pattern}`
          )
          .limit(5),
        supabase
          .from('service_orders')
          .select(
            'id, order_number, title, status, priority, client:clients(name)'
          )
          .eq('company_id', activeCompany.id)
          .or(
            `order_number.ilike.${pattern},title.ilike.${pattern},reported_issue.ilike.${pattern}`
          )
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      if (cancelled) return;

      setResults({
        clients: (clientsRes.data ?? []) as GlobalSearchResults['clients'],
        equipments: (equipsRes.data ?? []) as unknown as GlobalSearchResults['equipments'],
        serviceOrders: (osRes.data ?? []) as unknown as GlobalSearchResults['serviceOrders'],
      });
      setLoading(false);
      setOpen(true);
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeCompany, schemaMissing]);

  const totalMatches =
    results.clients.length +
    results.equipments.length +
    results.serviceOrders.length;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={query}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true);
          }}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-slate-200 bg-slate-50/80 focus:bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600 transition-all"
        />
        {loading ? (
          <Loader2 className="w-4 h-4 text-teal-600 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        ) : (
          query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setOpen(false);
              }}
              aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 z-40 overflow-hidden max-h-[420px] overflow-y-auto">
          {!loading && totalMatches === 0 ? (
            <div className="p-5 text-center text-xs text-slate-500">
              Nenhum cliente, equipamento ou ordem de serviço encontrado para{' '}
              <span className="font-semibold text-slate-700">"{query}"</span> nesta empresa.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {results.serviceOrders.length > 0 && (
                <div className="p-2">
                  <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5" />
                    Ordens de Serviço
                  </div>
                  {results.serviceOrders.map((os) => (
                    <button
                      key={os.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        if (onSelectServiceOrder) {
                          onSelectServiceOrder(os.id);
                        } else {
                          navigate(`/app/ordens-de-servico?os=${os.id}`);
                        }
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                          <span className="font-mono text-teal-700">{os.order_number}</span>
                          <span className="truncate">{os.title}</span>
                        </div>
                        {os.client?.name && (
                          <div className="text-[11px] text-slate-500 truncate">
                            Cliente: {os.client.name}
                          </div>
                        )}
                      </div>
                      <OSStatusBadge status={os.status} />
                    </button>
                  ))}
                </div>
              )}

              {results.clients.length > 0 && (
                <div className="p-2">
                  <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" />
                    Clientes
                  </div>
                  {results.clients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate(`/app/clientes?q=${encodeURIComponent(c.name)}`);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {c.trade_name || c.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {c.document_number || 'Sem documento'}
                          {c.phone ? ` • ${c.phone}` : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {results.equipments.length > 0 && (
                <div className="p-2">
                  <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5" />
                    Balanças / Equipamentos
                  </div>
                  {results.equipments.map((eq) => (
                    <button
                      key={eq.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate(`/app/equipamentos?q=${encodeURIComponent(eq.serial_number)}`);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {eq.brand} {eq.model}{' '}
                          <span className="font-mono text-teal-700">
                            (S/N: {eq.serial_number})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {eq.capacity_label ? `Cap.: ${eq.capacity_label} • ` : ''}
                          {eq.client?.name ?? ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
