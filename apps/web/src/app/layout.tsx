import type { Metadata } from "next";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "HAL — Voice AI Test Lab",
  description:
    "Self-hosted service for testing voice AI agents with simulated, turn-by-turn test calls and pass/fail judging.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions commonly inject attributes
          onto <body> before React hydrates, which is harmless. */}
      <body suppressHydrationWarning>
        <div className="app">
          <Sidebar />
          <div className="main">
            <header className="appbar">
              <div className="crumbs">
                <span className="crumb-chip">HAL</span>
                <span className="crumb-sep">/</span>
                <span className="crumb-current">Voice AI Test Lab</span>
              </div>
              <div className="appbar-actions">
                <Link href="/agents" className="btn secondary sm">
                  Hosted agents
                </Link>
                <Link href="/simulations/new" className="btn sm">
                  + New simulation
                </Link>
              </div>
            </header>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
