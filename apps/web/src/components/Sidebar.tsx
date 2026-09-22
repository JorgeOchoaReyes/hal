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
        match: (p) => p === "/" || p.startsWith("/tests"),
      },
      { href: "/tests/new", label: "New simulation", icon: icon("M12 5v14M5 12h14") },
    ],
  },
  {
    title: "Providers",
    items: [
      {
        href: "/agents",
        label: "Hosted agents",
        icon: icon("M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4ZM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"),
        match: (p) => p.startsWith("/agents"),
      },
    ],
  },
  {
    title: "Resources",
    items: [
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
