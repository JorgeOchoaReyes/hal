"use client";

import { useNewSimulation } from "./NewSimulationContext";

/** Opens the "New simulation" popup. Drop-in replacement for a Link to /simulations/new. */
export default function NewSimulationButton({ className }: { className?: string }) {
  const { openNewSimulation } = useNewSimulation();
  return (
    <button type="button" className={className} onClick={() => openNewSimulation()}>
      + New simulation
    </button>
  );
}
