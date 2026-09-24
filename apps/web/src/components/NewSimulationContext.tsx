"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import NewSimulationModal from "./NewSimulationModal";

interface NewSimulationContextValue {
  /** Open the "New simulation" popup, optionally prefilled from a production call. */
  openNewSimulation: (opts?: { fromCallId?: string }) => void;
}

const NewSimulationContext = createContext<NewSimulationContextValue | null>(null);

/** Opens the "New simulation" popup from anywhere in the app (header, sidebar, tables, …). */
export function useNewSimulation(): NewSimulationContextValue {
  const ctx = useContext(NewSimulationContext);
  if (!ctx) throw new Error("useNewSimulation must be used within NewSimulationProvider");
  return ctx;
}

export default function NewSimulationProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [fromCallId, setFromCallId] = useState<string | undefined>(undefined);

  return (
    <NewSimulationContext.Provider
      value={{
        openNewSimulation: (opts) => {
          setFromCallId(opts?.fromCallId);
          setOpen(true);
        },
      }}
    >
      {children}
      {open && (
        <NewSimulationModal
          fromCallId={fromCallId}
          onClose={() => setOpen(false)}
        />
      )}
    </NewSimulationContext.Provider>
  );
}
