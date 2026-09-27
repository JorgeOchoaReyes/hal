"use client";

import { useRouter } from "next/navigation";
import Modal from "./Modal";
import SimulationForm from "./SimulationForm";

export default function NewSimulationModal({
  onClose,
  fromCallId,
  folderId,
}: {
  onClose: () => void;
  fromCallId?: string;
  folderId?: string;
}) {
  const router = useRouter();

  return (
    <Modal open onClose={onClose} title="New simulation" wide>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Compose a test call: pick a target, define the caller persona, script the conversation turn
        by turn, and attach judges to score it.
      </p>
      <SimulationForm
        fromCallId={fromCallId}
        initialFolderId={folderId}
        onCancel={onClose}
        onCreated={(id) => {
          onClose();
          router.push(`/simulations/${id}`);
        }}
      />
    </Modal>
  );
}
