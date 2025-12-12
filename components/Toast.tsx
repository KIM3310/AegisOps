
import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface Props {
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}

export const ToastContainer: React.FC<Props> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: () => void }> = ({ toast, onRemove }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onRemove]);

  const styles = {
    success: 'bg-bg-card border-green-500/30 text-green-500',
    error: 'bg-bg-card border-sev1/30 text-sev1',
    info: 'bg-bg-card border-accent/30 text-accent',
  };

  const icons = {
    success: <CheckCircle2 className="w-4 h-4" />,
    error: <AlertCircle className="w-4 h-4" />,
    info: <Info className="w-4 h-4" />,
  };

  return (
    <div className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md animate-in slide-in-from-right-5 fade-in duration-300 ${styles[toast.type]}`}>
      {icons[toast.type]}
      <span className="text-sm font-medium text-text">{toast.message}</span>
      <button onClick={onRemove} className="ml-2 hover:opacity-70">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
