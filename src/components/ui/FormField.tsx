import React from 'react';

interface BaseFieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

interface InputFieldProps
  extends BaseFieldProps,
    React.InputHTMLAttributes<HTMLInputElement> {}

export const InputField: React.FC<InputFieldProps> = ({
  label,
  error,
  hint,
  required,
  id,
  className = '',
  ...rest
}) => {
  const inputId = id || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="space-y-1">
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-slate-700"
      >
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={inputId}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
            : 'border-slate-300 focus:border-teal-600 focus:ring-teal-600/20'
        } disabled:bg-slate-100 disabled:text-slate-500 ${className}`}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-slate-500">{hint}</p>
      )}
    </div>
  );
};

interface SelectFieldProps
  extends BaseFieldProps,
    React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  error,
  hint,
  required,
  id,
  children,
  className = '',
  ...rest
}) => {
  const selectId = id || `select-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="space-y-1">
      <label
        htmlFor={selectId}
        className="block text-xs font-medium text-slate-700"
      >
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        id={selectId}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:outline-none focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
            : 'border-slate-300 focus:border-teal-600 focus:ring-teal-600/20'
        } disabled:bg-slate-100 ${className}`}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-slate-500">{hint}</p>
      )}
    </div>
  );
};

interface TextareaFieldProps
  extends BaseFieldProps,
    React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const TextareaField: React.FC<TextareaFieldProps> = ({
  label,
  error,
  hint,
  required,
  id,
  rows = 3,
  className = '',
  ...rest
}) => {
  const textareaId = id || `textarea-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="space-y-1">
      <label
        htmlFor={textareaId}
        className="block text-xs font-medium text-slate-700"
      >
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <textarea
        id={textareaId}
        rows={rows}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
            : 'border-slate-300 focus:border-teal-600 focus:ring-teal-600/20'
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-slate-500">{hint}</p>
      )}
    </div>
  );
};

interface CheckboxFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  description?: string;
}

export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  label,
  description,
  id,
  ...rest
}) => {
  const chkId = id || `chk-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <label
      htmlFor={chkId}
      className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50/70 cursor-pointer transition-colors"
    >
      <input
        id={chkId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
        {...rest}
      />
      <div className="text-xs">
        <div className="font-medium text-slate-800">{label}</div>
        {description && (
          <div className="text-slate-500 mt-0.5 leading-relaxed">{description}</div>
        )}
      </div>
    </label>
  );
};
