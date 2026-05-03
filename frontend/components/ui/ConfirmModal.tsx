'use client';

import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  /** When true, primary action is disabled (e.g. payment not completed). */
  confirmDisabled?: boolean;
  /** Shown below the message (e.g. payment warning). */
  warning?: string;
  /** Extra body content (e.g. booking summary table). */
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText = 'Confirm',
  confirmDisabled = false,
  warning,
  children,
  onCancel,
  onConfirm
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} />
          <motion.div className="glass-card modal-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
            <h3 style={{ marginTop: 0 }}>{title}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: children || warning ? '0.75rem' : undefined }}>{message}</p>
            {warning ? (
              <p
                style={{
                  margin: '0 0 0.75rem',
                  padding: '0.5rem 0.65rem',
                  background: '#fffbeb',
                  color: '#92400e',
                  borderRadius: 8,
                  fontSize: '0.9rem',
                  border: '1px solid #fcd34d'
                }}
              >
                {warning}
              </p>
            ) : null}
            {children ? <div style={{ marginBottom: '1rem' }}>{children}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="glass-btn" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmDisabled}
                onClick={() => {
                  if (!confirmDisabled) onConfirm();
                }}
                style={
                  confirmDisabled
                    ? { opacity: 0.5, cursor: 'not-allowed' }
                    : undefined
                }
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
