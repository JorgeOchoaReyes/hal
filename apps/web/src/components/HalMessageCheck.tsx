import type { TestResult } from "@hal/core";
import { halMessageCheck } from "@/lib/halMessageCheck";

export default function HalMessageCheck({ run }: { run: TestResult }) {
  const check = halMessageCheck(run);
  if (!check) return null;
  const matched = check.expected.filter((item) => item.matched).length;
  const pending = run.status === "running" || run.status === "queued";
  return <section className="card"><p className="field-label">HAL testing metadata</p><h2 style={{ marginTop: 6 }}>Expected message match</h2>
    <p className="muted">{matched} of {check.expected.length} fixed testing agent messages matched the transcript in script order. Matching ignores case and punctuation; it does not judge meaning.</p>
    {check.expected.length ? <div className="hal-check-list">{check.expected.map((item, index) => <div className="hal-check-row" key={`${item.source}-${index}`}>
      <span className={`label label-${item.matched ? "pass" : "fail"}`}>{item.matched ? "MATCHED" : pending ? "WAITING" : "NOT MATCHED"}</span>
      <div><strong>{item.source}</strong><div>Expected: {item.text}</div>{item.matched && item.actualText !== item.text && <div className="muted">Heard: {item.actualText}</div>}</div>
    </div>)}</div> : <p className="muted">This simulation has no fixed messages to compare.</p>}
    {check.unplanned.length > 0 && <details><summary>Other testing agent messages ({check.unplanned.length})</summary><ol>{check.unplanned.map((text, index) => <li key={index}>{text}</li>)}</ol></details>}
    {check.instructionCount > 0 && <p className="muted">{check.instructionCount} prompted or conditional instruction{check.instructionCount === 1 ? "" : "s"} cannot be matched to fixed wording.</p>}
    {check.expectsHangup && <p className="muted">The script ends the call. A transcript alone cannot verify which party hung up.</p>}
  </section>;
}
