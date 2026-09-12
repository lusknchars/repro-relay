# Repro Relay

Repro Relay connects a reported application problem to an investigation, reviewed evidence, an engineering handoff, and an owner update.

## Language

**Case**: The continuing record of a reported problem, its investigation attempts, evidence, decisions, and outcomes.
_Avoid_: Run, chat, ticket as interchangeable names for a case.

**Investigation run**: One bounded execution attempt against a stated application environment and source context. A case can have several runs.
_Avoid_: Case, verified result.

**Action receipt**: An attributable record of a tool action and its reported outcome. It supports claims about that action, not every explanation an investigator attaches to it.
_Avoid_: Root-cause proof.

**Finding**: A statement proposed from an investigation, with its supporting evidence, uncertainty, and review state.
_Avoid_: Verified fact for an unreviewed finding.

**Reviewed evidence**: An observation whose stated support and applicability a reviewer has accepted. Review does not automatically establish a root cause or a successful fix.
_Avoid_: Verified fix.

**Project memory**: Reviewed knowledge retained for use in later investigations, together with its source and applicability.
_Avoid_: Conversation history as authoritative guidance.

**Correction**: A recorded change to a claim or its applicability that preserves the earlier claim and explains the change.
_Avoid_: Overwrite.

**Handoff**: A versioned package of the problem, attempts, evidence, and remaining questions that lets engineering continue the work.
_Avoid_: Repair, deployment.

**Action approval**: A permitted person's decision about a specific proposed action on a stated target under stated conditions.
_Avoid_: Blanket approval of the agent.

**Owner update**: A case-derived message addressed to the person responsible for the next decision or action.
_Avoid_: Customer notification when the destination is an internal owner.

**Delivered update**: An owner update whose acceptance by the destination provider is confirmed. It does not establish that a person read or acted on the message.
_Avoid_: Queued, read, resolved.

**Investigation replay**: A presentation of recorded actions and evidence from a past investigation. It does not execute those actions again.
_Avoid_: Live run, rerun.

**Retest**: A new execution of a stated check against a stated environment or build.
_Avoid_: Replay.

**Useful investigation**: An investigation whose evidence or actionable blocker lets its intended recipient proceed without another avoidable clarification round.
_Avoid_: Completed run as a synonym.
