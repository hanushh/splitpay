import React, { createContext, useCallback, useContext, useState } from 'react';

import Toast, { type ToastType } from '@/components/ui/Toast';
import { hapticSuccess, hapticError } from '@/lib/haptics';

interface ToastState {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});

export function useToast(): ToastContextType {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (type: ToastType, message: string, duration = 3000) => {
      if (type === 'success') hapticSuccess();
      if (type === 'error') hapticError();
      setToast({ id: Date.now(), type, message, duration });
    },
    [],
  );

  const handleHide = useCallback(() => {
    setToast(null);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast
          key={toast.id}
          type={toast.type}
          message={toast.message}
          visible
          onHide={handleHide}
          duration={toast.duration}
        />
      )}
    </ToastContext.Provider>
  );
}
