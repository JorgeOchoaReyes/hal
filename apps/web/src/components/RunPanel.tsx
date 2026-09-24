"use client";

import { useState } from "react";
import RunModal from "./RunModal";

/** Opens the run-configuration popup: agent, direction, judges, label, repeat count. */
export default function RunPanel({ testCaseId }: { testCaseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>▶ Run test call</button>
      {open && <RunModal testCaseId={testCaseId} onClose={() => setOpen(false)} />}
    </>
  );
}
