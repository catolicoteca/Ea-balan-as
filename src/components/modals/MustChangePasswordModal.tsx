import React, { useState } from 'react';
import { Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { completePasswordChange } from '../../lib/employeeAdmin';
import { Button } from '../ui/Button';
import { InputField } from '../ui/FormField';

interface MustChangePasswordModalProps {
  onSuccess: () => void;
}

export const MustChangePasswordModal: React.FC<MustChangePasswordModalProps> = ({ onSuccess }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('A nova senha deve ter no mínimo 8 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('A confirmação não coincide com a nova senha digitada.');
      return;
    }

    setLoading(true);
    try {
      await completePasswordChange(newPassword);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Falha ao redefinir sua senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Troca Obrigatória de Senha
            </h2>
            <p className="text-xs text-slate-500">
              Primeiro acesso ou redefinição administrativa
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-600 mb-5 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
          Sua conta foi criada ou redefinida com uma senha provisória pela administração. Por razões de segurança, você deve definir sua nova senha pessoal antes de acessar o sistema.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <InputField
            label="Nova Senha Pessoal"
            type="password"
            required
            placeholder="Mínimo de 8 caracteres"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />

          <InputField
            label="Confirmar Nova Senha"
            type="password"
            required
            placeholder="Repita a nova senha"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          <Button
            type="submit"
            className="w-full mt-2"
            isLoading={loading}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            Salvar Nova Senha e Entrar
          </Button>
        </form>
      </div>
    </div>
  );
};
