---
name: analyze-sessions
description: Read-only reports over past Pi session transcripts. Use when the user asks what they spent (cost per project, per model, per day, per session, "how much did I spend this week"), wants to mine their past prompts or prompting habits, wants to show or replay an earlier session, or wants to search transcripts for where something was discussed ("when did we talk about X", "find the session where...").
---

# Analyze sessions

Four Node scripts in `scripts/` read Pi's JSONL session files. They need no install or build (`node scripts/<name>.ts`), and they never write anything.

Default roots are `$PI_CODING_AGENT_SESSION_DIR` or `~/.pi/agent/sessions`, plus `~/.pi/learn/sessions` when it exists. Add roots with `--root DIR`; use `--no-default-roots` to scan only those. Malformed lines are skipped and counted in a `warning:` on stderr.

| Script | Answers | Subagents by default |
|---|---|---|
| `cost.ts` | spend grouped `--by day\|project\|model\|session\|root\|total` (default `day`, last 7 days unless `--since`/`--until`/`--session`) | included |
| `prompts.ts` | the user's own prompts, as Markdown grouped by project, or `--format jsonl` | excluded |
| `show.ts [ID]` | one session as a Markdown transcript (newest match) | excluded |
| `search.ts PATTERN` | hits in user/assistant text and thinking, with a ready `show.ts` command per session | excluded |

Shared filters: `--since/--until` (`7d`, `12h`, `2w`, `30m`, `YYYY-MM-DD`, ISO), `--cwd`, `--model`, `--provider` (substrings, repeatable), `--session ID-prefix`, `--include-subagents`/`--no-subagents`, `--limit`, `--min-cost`, `--min-messages`, `--errors-only`, `--grep` (user prompts). Each script prints its own options with `--help`.

## Rules

- Run the scripts; do not hand-parse the JSONL.
- Pick the grouping that answers the question and state the window you used. `cost.ts` counts assistant, tool, compaction, and usage-entry cost. `--by model` credits each message to the model that produced it.
- For habits and preferences, keep the `prompts.ts` default, which drops helper (`[role] …` names or launched by a subagent tool) and memory (`om-…`) sessions. Add `--include-generated` only when the question is about agent-generated sessions.
- Use `--json` (cost) or `--format jsonl` (prompts) when you will post-process the output.
- For a long session, cap the output: `show.ts ID --max-tool-output 300 --max-thinking=-1`. Add `--include-subagents-content` to append the transcripts it launched.
- Transcripts can contain secrets. Quote only what the user needs.

## Examples

```bash
node scripts/cost.ts --since 7d --by model
node scripts/cost.ts --since 2026-09-01 --by project --limit 10 --json
node scripts/prompts.ts --since 30d --cwd myproject --min-chars 40
node scripts/search.ts "rate limit" --in user --since 2w
node scripts/search.ts 'CORS|preflight' --regex
node scripts/show.ts 01a0b4c3 --max-tool-output 500
```
