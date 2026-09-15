"use client";

import ImportWizard from "./ImportWizard";

interface ImportModalProps {
  caseId: string;
  onImported: (count: number) => void;
  onClose: () => void;
}

/**
 * Standalone modal for the modernized file-import wizard.
 * Wraps ImportWizard (upload → auto/LLM field mapping → preview → import)
 * with modal chrome. Opened from the simple "Import" button on the case page.
 */
export default function ImportModal({ caseId, onImported, onClose }: ImportModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-lg">📂 Dateien importieren</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <ImportWizard caseId={caseId} onImported={onImported} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
