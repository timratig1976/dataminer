"use client";

import ImportWizard from "./ImportWizard";
import { Modal } from "@/components/ui/ModalMaster";

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
    <Modal
      onClose={onClose}
      title="Dateien importieren"
      icon="📂"
      maxWidth="42rem"
    >
      <div className="p-6">
        <ImportWizard caseId={caseId} onImported={onImported} onClose={onClose} />
      </div>
    </Modal>
  );
}
