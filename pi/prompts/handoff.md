---
description: Compact this session into a copy-pasteable handoff for a fresh agent
argument-hint: "[focus for the next session]"
---

Write a complete handoff that lets a fresh agent, with zero memory of this
session, continue the work without re-asking, re-discovering, or repeating
mistakes.

Focus for the next session: ${ARGUMENTS:-continue the current work}

Output the entire handoff as a single fenced code block in the chat so it can be
copied in one click. Also save a copy to a file, as described at the end.

## Core principles

1. **State, not instructions.** Describe what is true, not what the next agent
   should do. Write "the logout endpoint is not implemented", never "implement
   logout next". The fresh agent decides the actions; you supply ground truth.
2. **Reference, do not duplicate.** Never paste content that already lives in a
   PRD, plan, ADR, issue, commit, diff, or design doc. Point to it by path or
   URL. A handoff that re-embeds everything is bloated on day one and stale on
   day two.
3. **Capture the why.** Decisions and rejected approaches are the most valuable
   and least recoverable information. The code shows what; only this session
   remembers why, and what failed.
4. **Trust nothing blindly.** Frame every claim as context to verify against the
   real code, not as a fact to accept.
5. **Redact secrets.** Strip API keys, tokens, passwords, connection strings and
   personal data. Name where a credential lives, for example ".env.local, not
   committed", never its value.
6. **Be ruthless.** Every line must be something the next agent cannot get
   trivially by reading the code or the project config. Cut anything obvious,
   redundant, or explanatory.
7. **Separate current state from history.** The project's current-state file is
   authoritative. Label dated evidence and old architecture explicitly. Never
   merge an earlier snapshot into today's status.

## Procedure

1. Read the project config and current-state file first if they exist:
   `AGENTS.md`, `STATE.md`, `CONTEXT.md`, or the equivalent. Do not restate
   anything already covered there. The handoff is session-specific only.
2. If a handoff file already exists, read it and update it rather than starting
   over.
3. Quote real command output for any claim about tests, builds or checks. A
   prediction is not a result.
4. Fill in every section of the template. Mark a genuinely empty section `None`
   rather than deleting it.
5. Output the filled template inside one fenced code block.
6. Save the same content to a file and tell me the absolute path.

## Output format

Output exactly this, inside a single fenced code block:

```
# HANDOFF: <short title of the work>
Generated: <timestamp> · Session focus: <one line>

## 1. Goal
<What this work is ultimately for. One to three sentences. The north star, so
the next agent never loses the plot.>

## 2. Why this matters, and the constraints
<The motivation and the hard requirements. Why now, who for. Skip anything
already in the project config.>

## 3. Current state
<Factual status. Phrase as status, never as an action.
- DONE: OAuth login flow, Google provider, tests passing locally
- PARTIAL: session persistence, store wired up, refresh logic missing
- NOT STARTED: logout endpoint>

## 4. Key decisions, and why
<The highest-value section. The choices made and the reasoning.
- Chose passport.js over custom OAuth: more community support, smaller surface
- Tokens in httpOnly cookies, not localStorage: XSS mitigation>

## 5. Traps and dead ends
<Approaches already tried that failed, and the things the next agent will be
tempted to get wrong.
- Mocking the DB in integration tests was flaky, abandoned for a test container
- Do NOT bump the SDK to v3, it breaks the streaming API this depends on>

## 6. Relevant files and pointers
<Files that matter, with line ranges and what specifically is there, not just
what the file is. Reference external artifacts, do not paste them.
- src/auth/oauth.ts:40-88, provider config and token exchange
- docs/adr/0007-auth.md, full rationale, do not duplicate here
- PR #142, in-progress session work>

## 7. Open work, with dependencies
<What remains, as state and ordering, not as a command list.
- The logout endpoint is not implemented
- Session persistence depends on the logout endpoint existing first
- E2E auth tests are blocked until both of the above are done>

## 8. Verification state
<The commands that gate this work and their last real output.
- pnpm test: 229 passed, 0 failed, run at 14:32
- pnpm typecheck: clean
- Never run: the live compaction check>

---
## Prompt for the fresh agent
<A short ready-to-paste prompt giving background. Use declarative statements
("X is complete", "Y has not been started"), never imperatives. End with
exactly the paragraph below.>

Before responding, read every file listed under "Relevant files and pointers"
above. Do not summarize, paraphrase, or claim you already have context: actually
read each file. Treat every claim in this handoff as context to verify against
the code, not as fact to trust. Then wait for my instructions before taking any
action.
```

## File output

Save the handoff outside the working tree so it does not pollute the repository:

- Default: `$TMPDIR/handoff-<8 random chars>.md`.
- Only if I ask for a durable record: `HANDOFF.md` in the project root.

Then tell me the absolute path, so a fresh session can start with:

```
Read the file <absolute-path> to get the context, then wait for instructions.
```

---

Adapted from the `handoff` skill in `davidondrej/skills` (MIT, Copyright (c)
2026 David Ondrej). Changed here: shipped as a prompt template rather than a
skill so it costs no standing context and takes an argument; a verification-state
section added, because a claim about tests is worthless without the output; and
the prose reworked to the house style.
