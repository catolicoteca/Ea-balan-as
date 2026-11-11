import React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="py-10 px-4 text-center flex flex-col items-center justify-center">
      <div className="w-11 h-11 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500 max-w-md mt-1 leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};

interface AlertBannerProps {
  variant?: 'error' | 'success' | 'warning' | 'info';
  title?: string;
  message: string;
  onDismiss?: () => void;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({
  variant = 'info',
  title,
  message,
  onDismiss,
}) => {
  const styles = {
    error: {
      box: 'bg-red-50 border-red-200 text-red-900',
      icon: <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />,
    },
    success: {
      box: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
    },
    warning: {
      box: 'bg-amber-50 border-amber-200 text-amber-900',
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
    },
    info: {
      box: 'bg-sky-50 border-sky-200 text-sky-900',
      icon: <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />,
    },
  }[variant];

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-xs flex items-start justify-between gap-3 ${styles.box}`}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        {styles.icon}
        <div className="leading-relaxed">
          {title && <div className="font-semibold mb-0.5">{title}</div>}
          <div>{message}</div>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium opacity-70 hover:opacity-100 shrink-0"
        >
          Fechar
        </button>
      )}
    </div>
  );
};
