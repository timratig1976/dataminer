import React, { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    requireTextConfirmation?: string; // e.g. "LÖSCHEN" or Case Name for high-impact delete
    onConfirm: () => void | Promise<void>;
    onClose: () => void;
}

export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = "Unwiderruflich löschen",
    cancelLabel = "Abbrechen",
    danger = true,
    requireTextConfirmation,
    onConfirm,
    onClose,
}: ConfirmDialogProps) {
    if (!isOpen) return null;

    const [inputVal, setInputVal] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const isMatch = requireTextConfirmation 
        ? inputVal.trim() === requireTextConfirmation.trim()
        : true;

    const handleConfirm = async () => {
        if (!isMatch || submitting) return;
        setSubmitting(true);
        try {
            await onConfirm();
        } finally {
            setSubmitting(false);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div 
                className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border space-y-4 animate-in fade-in zoom-in-95 duration-150"
                style={{ borderColor: 'var(--border)' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-red-100 text-red-600">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-bold text-slate-900">{title}</h3>
                        <div className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                            {message}
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {requireTextConfirmation && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                        <label className="text-[11.5px] font-medium text-slate-700 block">
                            Tippe zur Bestätigung <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200 select-all font-mono">{requireTextConfirmation}</span> ein:
                        </label>
                        <input
                            type="text"
                            value={inputVal}
                            onChange={e => setInputVal(e.target.value)}
                            placeholder={requireTextConfirmation}
                            className="w-full text-xs p-2 rounded-lg border focus:outline-red-500 font-mono"
                            autoFocus
                        />
                    </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="btn-v2"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={!isMatch || submitting}
                        className={`btn-v2 ${danger ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : 'btn-v2-primary'} opacity-100 disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                        {submitting ? 'Lösche...' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
