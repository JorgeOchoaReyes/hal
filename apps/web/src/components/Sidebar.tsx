"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  external?: boolean;
  match?: (path: string) => boolean;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const GROUPS: NavGroup[] = [
  {
    title: "Simulation",
    items: [
      {
        href: "/",
        label: "Simulations",
        icon: icon("M4 6h16M4 12h16M4 18h16"),
        match: (p) => p === "/" || p.startsWith("/simulations"),
      },
      {
        href: "/results",
        label: "Results",
        icon: icon("M3 3v18h18M7 15l3-3 3 3 4-5"),
        match: (p) => p.startsWith("/results"),
      },
      {
        href: "/production-calls",
        label: "Production calls",
        icon: icon("M9 18V5l12-2v13M9 13l12-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"),
        match: (p) => p.startsWith("/production-calls") || p.startsWith("/transcriptions"),
      },
    ],
  },
  {
    title: "Agents",
    items: [
      {
        href: "/targets",
        label: "My agents",
        icon: icon("M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4ZM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"),
        match: (p) => p.startsWith("/targets"),
      },
      {
        href: "/agents",
        label: "Providers",
        icon: icon("M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"),
        match: (p) => p.startsWith("/agents"),
      },
      {
        href: "/judges",
        label: "Judges",
        icon: icon("M12 3v18M6 7h12M7 7l-3 6a3 3 0 0 0 6 0L7 7Zm10 0-3 6a3 3 0 0 0 6 0l-3-6ZM8 21h8"),
        match: (p) => p.startsWith("/judges"),
      },
    ],
  },
  {
    title: "Resources",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: icon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.3 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"),
        match: (p) => p.startsWith("/settings"),
      },
      {
        href: "https://github.com/JorgeOchoaReyes/hal#readme",
        label: "Docs",
        icon: icon("M4 4h11l5 5v11H4zM15 4v5h5"),
        external: true,
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname() ?? "/";

  return (
    <aside className="sidebar">
      <Link href="/" className="brand-side">
        <span className="eye" aria-hidden />
        <span className="brand-name">
          HAL
          <small>voice ai test lab</small>
        </span>
      </Link>

      <nav className="nav">
        {GROUPS.map((g) => (
          <div className="nav-group" key={g.title}>
            <div className="nav-group-title">{g.title}</div>
            {g.items.map((it) => {
              const active = it.match ? it.match(pathname) : pathname === it.href;
              if (it.external) {
                return (
                  <a key={it.href} href={it.href} className="nav-link" target="_blank" rel="noreferrer">
                    <span className="nav-icon">{it.icon}</span>
                    {it.label}
                    <span className="nav-ext" aria-hidden>↗</span>
                  </a>
                );
              }
              return (
                <Link key={it.href} href={it.href} className={`nav-link${active ? " active" : ""}`}>
                  <span className="nav-icon">{it.icon}</span>
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
