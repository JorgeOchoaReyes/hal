import type { ReactNode } from "react";

interface PageIntroProps {
  number: string;
  section: string;
  title: string;
  children: ReactNode;
  stats?: Array<{ label: string; value: string | number }>;
}

/** Shared page hierarchy for the main workspaces. Content lives in each page. */
export default function PageIntro({ number, section, title, children, stats }: PageIntroProps) {
  return (
    <header className="page-intro">
      <div className="page-intro-meta">
        <span className="page-kicker"><span className="page-kicker-dot" />{section}</span>
        <span className="page-index">{number} / 08</span>
      </div>
      <div className="page-intro-body">
        <div>
          <h1>{title}</h1>
          <p className="sub">{children}</p>
        </div>
        <span className="page-intro-glyph" aria-hidden="true">{number}</span>
      </div>
      {stats?.length ? (
        <dl className="page-stats">
          {stats.map((stat) => (
            <div key={stat.label} className="page-stat">
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}
