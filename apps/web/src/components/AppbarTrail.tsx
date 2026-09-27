"use client";

import { usePathname } from "next/navigation";

const sections: Array<[string, string]> = [
  ["/simulations", "Simulations"],
  ["/results", "Results"],
  ["/production-calls", "Production calls"],
  ["/targets", "My agents"],
  ["/agents", "Providers"],
  ["/testing-agents", "Testing agents"],
  ["/judges", "Judges"],
  ["/settings", "Settings"],
];

export default function AppbarTrail() {
  const pathname = usePathname() ?? "/";
  const section = pathname === "/" ? "Simulations" : sections.find(([path]) => pathname.startsWith(path))?.[1];
  return (
    <div className="crumbs" aria-label="Current section">
      <span className="crumb-chip">HAL</span>
      <span className="crumb-sep">/</span>
      <span className="crumb-current">Voice AI Test Lab</span>
      {section && <><span className="crumb-sep">/</span><span className="crumb-section">{section}</span></>}
    </div>
  );
}
