import type { Metadata } from "next";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";
import NewSimulationButton from "@/components/NewSimulationButton";
import NewSimulationProvider from "@/components/NewSimulationContext";
import SecretVisibilityProvider from "@/components/SecretVisibilityContext";
import AppbarTrail from "@/components/AppbarTrail";
import "./globals.css";

export const metadata: Metadata = {
  title: "HAL — Voice AI Test Lab",
  description:
    "Self-hosted service for testing voice AI agents with simulated, turn-by-turn test calls and pass/fail judging.",
};

// Apply the persisted theme before first paint so there's no light→dark flash.
const themeInit = `(function(){try{var t=localStorage.getItem('hal-theme');if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      {/* suppressHydrationWarning: browser extensions commonly inject attributes
          onto <body> before React hydrates, which is harmless. */}
      <body suppressHydrationWarning>
        <SecretVisibilityProvider><NewSimulationProvider>
          <div className="app">
            <Sidebar />
            <div className="main">
              <header className="appbar">
                <AppbarTrail />
                <div className="appbar-actions">
                  <Link href="/agents" className="btn secondary sm">
                    Hosted agents
                  </Link>
                  <NewSimulationButton className="btn sm" />
                  <ThemeToggle />
                </div>
              </header>
              <main className="content">{children}</main>
            </div>
          </div>
        </NewSimulationProvider></SecretVisibilityProvider>
      </body>
    </html>
  );
}
