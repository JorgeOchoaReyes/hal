import type { RunContext, TestCase, TargetAgent, HostedTestingAgent, ProviderAccount } from "@hal/core";
import { getTarget, getJudge } from "./store";

/** Whitelist historical display fields; never copy credentials, headers or keys. */
export function snapshotRun(tc: TestCase): RunContext {
  const target = tc.targetAgentId ? getTarget(tc.targetAgentId) : undefined;
  return structuredClone({
    simulationName: tc.name,
    transport: tc.target.transport,
    testingAgent: { name: tc.scenario.persona.name, persona: tc.scenario.persona, configuration: { structured: tc.scenario.structured, steps: tc.scenario.structured ? undefined : tc.scenario.steps } },
    targetAgent: {
      id: target?.id, name: target?.name ?? tc.target.name,
      provider: target?.provider, externalAgentId: target?.externalAgentId,
      direction: target?.direction,
      persona: tc.target.transport === "mock" ? { name: tc.target.name, systemPrompt: tc.target.mock.systemPrompt } : undefined,
      phoneNumber: "phoneNumber" in tc.target ? tc.target.phoneNumber : undefined,
    },
    judge: tc.judge,
    judges: (tc.judgeIds ?? []).flatMap((id) => { const j = getJudge(id); return j ? [j] : []; }),
  });
}

export function hostedContext(context: RunContext, account: ProviderAccount, agent: HostedTestingAgent,
  phoneNumber: string, target?: TargetAgent, outboundIsTarget = false, fromNumber?: string): RunContext {
  const testerPathway = account.provider === "bland" && Boolean(agent.spec?.structured || agent.spec?.steps?.length || agent.spec?.pathwayId);
  return structuredClone({
    ...context, transport: account.provider,
    account: { id: account.id, label: account.label, provider: account.provider },
    testingAgent: {
      id: agent.id, name: agent.name, provider: agent.provider, externalAgentId: agent.externalAgentId,
      pathwayId: testerPathway ? agent.externalAgentId : undefined,
      pathwaySource: testerPathway ? "dispatch" : undefined,
      executionMode: account.provider === "bland" ? testerPathway ? "pathway" : "prompt" : undefined,
      persona: agent.spec?.persona, configuration: { model: agent.spec?.model, voice: agent.spec?.voice, structured: agent.spec?.structured, steps: agent.spec?.steps }, direction: outboundIsTarget ? "inbound" : "outbound",
      phoneNumber: outboundIsTarget ? phoneNumber : fromNumber,
    },
    targetAgent: {
      id: target?.id, name: target?.name ?? "Agent under test", provider: target?.provider,
      pathwayId: target?.provider === "bland" ? target.externalAgentId : undefined,
      pathwaySource: target?.provider === "bland" && target.externalAgentId ? outboundIsTarget ? "dispatch" : "saved-agent" : undefined,
      externalAgentId: target?.externalAgentId, direction: outboundIsTarget ? "outbound" : "inbound",
      phoneNumber: outboundIsTarget ? fromNumber : phoneNumber,
    },
  });
}
