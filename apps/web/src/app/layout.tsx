import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "HAL — Voice AI Test Lab",
  description:
    "Self-hosted service for testing voice AI agents with simulated, turn-by-turn test calls and pass/fail judging.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="container">
            <Link href="/" className="brand">
              <span className="eye" aria-hidden />
              <span>
                HAL <small>voice ai test lab</small>
              </span>
            </Link>
            <nav>
              <Link href="/" className="btn secondary">
                Dashboard
              </Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
