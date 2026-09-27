import type { Scenario } from "@hal/core";
import { testingOpeningMessage } from "@/lib/openingMessages";

export default function OpeningMessageWarning({ scenario, mainMessage }: { scenario: Scenario; mainMessage?: string }) {
  const testingMessage = testingOpeningMessage(scenario);
  if (!testingMessage || !mainMessage) return null;
  return <div className="card opening-warning" role="alert">
    <strong>Both agents are set to speak first</strong>
    <p>The testing agent opens with “{testingMessage}”. The main agent opens with “{mainMessage}”. Change one opening message before running so they do not talk over each other.</p>
  </div>;
}
