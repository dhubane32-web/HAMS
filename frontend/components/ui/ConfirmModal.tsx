'use client';

import { motion, AnimatePresence } from 'framer-motion';

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmModal({ open, title, message, confirmText = 'Confirm', onCancel, onConfirm }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} />
          <motion.div className="glass-card modal-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
            <h3 style={{ marginTop: 0 }}>{title}</h3>
            <p style={{ color: 'var(--text-muted)' }}>{message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="glass-btn" onClick={onCancel}>Cancel</button>
              <button type="button" onClick={onConfirm}>{confirmText}</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
