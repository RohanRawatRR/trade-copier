'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { Toast } from '@/components/ui/toast';
import { X } from 'lucide-react';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  title?: string;
  description: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: Omit<ToastMessage, 'id'>) => void;
  showSuccess: (message: string, title?: string) => void;
  showError: (message: string, title?: string) => void;
  showWarning: (message: string, title?: string) => void;
  showInfo: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const duration = message.duration ?? 5000;
    const newToast: ToastMessage = {
      ...message,
      id,
      duration,
    };

    setToasts((prev) => [...prev, newToast]);

    // Auto remove after duration
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const showSuccess = useCallback((message: string, title?: string) => {
    showToast({ description: message, title, variant: 'success' });
  }, [showToast]);

  const showError = useCallback((message: string, title?: string) => {
    showToast({ description: message, title, variant: 'error' });
  }, [showToast]);

  const showWarning = useCallback((message: string, title?: string) => {
    showToast({ description: message, title, variant: 'warning' });
  }, [showToast]);

  const showInfo = useCallback((message: string, title?: string) => {
    showToast({ description: message, title, variant: 'info' });
  }, [showToast]);

  const variantMap: Record<ToastVariant, 'default' | 'success' | 'destructive' | 'warning' | 'info'> = {
    default: 'default',
    success: 'success',
    error: 'destructive',
    warning: 'warning',
    info: 'info',
  };

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {children}
      <div className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            variant={variantMap[toast.variant]}
            title={toast.title}
            description={toast.description}
            onClose={() => removeToast(toast.id)}
            className="mb-2"
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
