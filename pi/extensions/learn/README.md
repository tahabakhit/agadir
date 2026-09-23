# learn

A learn mode for the main Pi agent. When it is on, the agent tutors instead of
just doing the work, and two extra tools let it check understanding and
schedule spaced review. When it is off, the tools are inactive and the prompt
is unchanged, so they cost no tokens.

## Use

```bash
pi --learn                  # start with learn mode on
pi --learn -p "Teach me Go channels"
```

Pi reads the word after an extension flag as the flag's value, so
`pi -p --learn "prompt"` loses the prompt. Put `--learn` before another
option or last, or write `--learn=true`.

Inside a session:

| Command | Effect |
|---|---|
| `/learn` | Toggle learn mode |
| `/learn on`, `/learn off` | Set it explicitly |
| `/learn status` | Show the mode and the number of due reviews |
| `/review` | Start a review session on due items (turns learn mode on) |

The mode is saved per session branch, so resuming a session or moving in
`/tree` restores it. A `learn` footer item shows while it is on. In the
interactive UI, starting a session with due items shows
`N reviews due, run /review`.

## What the agent does in learn mode

- Asks one question first: what you want to be able to do and your level.
- Holds back answers only for the skill you are learning. Setup, boilerplate
  and unrelated fixes are done normally. Say "just show me" to get the answer.
- New concepts: you attempt first, then a worked example, then faded steps,
  then a solo problem. Fading is faster if you are experienced.
- Hints escalate; the answer comes after two tries.
- In a codebase: predict what code does, then check; explain hard parts back.
- For 2-10 lines of real decision logic, it scaffolds the file, signature and
  tests, leaves one `TODO(human)` with Context, Task and Guidance, and waits.
  If your code is wrong it hints instead of fixing it.
- One question per turn, short replies, small ASCII diagrams when structure
  matters (sometimes asking you to sketch first).
- Ends a topic with an unaided `quiz`, then adds review items and a log entry.
  Confidence, rereading and summaries never count as evidence.

## Tools (active only in learn mode)

**`quiz`** asks one or more questions in a terminal screen.

- `single` and `multi`: choices with stable values, `correct` as an array of
  values, and an explanation. Choices are shuffled and graded by value;
  `multi` needs the exact set. Unknown or duplicate values are rejected before
  anything is shown. You get immediate feedback.
- `recall`: you type the answer; it comes back to the agent to grade against
  a reference answer, which you see after answering.
- Every question has "I don't know" (exclusive with other choices, reported as
  a gap rather than an error) and an optional note.
- Without the terminal UI (print, JSON or RPC mode) the tool fails and tells
  the agent to ask in chat.

**`review`** keeps a spaced-review queue across sessions.

| Action | Arguments |
|---|---|
| `add` | `topic`, `prompt`, `answer`, optional `misconception` |
| `due` | optional `limit` (default 10); oldest first, with answers for the agent |
| `grade` | `id`, `outcome`: `again`, `good` or `easy` |
| `list` | optional `topic` filter |
| `log` | `topic`, `learned`, optional `misconceptions`, `next` |

Schedule: first review after 1 day, then about 11, 21, 90 and 180 days.
`again` goes back to 1 day; `easy` skips one step. Answers are hidden from the
transcript rendering of review results.

## Storage

`${AGADIR_LEARN_DIR:-~/.local/share/agadir/learn}/`

- `reviews.json`: the queue, written atomically (temp file and rename). A
  corrupt file is reported and never overwritten.
- `log.md`: dated Markdown entries from `review log`.

## Evidence

- Unrestricted AI help raised practice scores 48% but cut exam scores 17%;
  hint-only tutoring removed the harm (Bastani et al., [PNAS 2025](https://www.pnas.org/doi/10.1073/pnas.2422633122)).
- A structured AI tutor with enforced steps more than doubled median learning
  gains, in less time (Kestin et al., [Sci Rep 2025](https://www.nature.com/articles/s41598-025-97652-6)).
- Developers using AI scored 17% lower on a follow-up quiz; those who asked
  conceptual questions did best, and those who let the AI debug did worst
  ([Anthropic 2026](https://www.anthropic.com/research/AI-assistance-coding-skills)).
- Retrieval practice beats rereading ([Roediger & Karpicke 2006](https://journals.sagepub.com/doi/10.1111/j.1467-9280.2006.01693.x);
  [Dunlosky et al. 2013](https://journals.sagepub.com/doi/abs/10.1177/1529100612453266)).
- Worked examples with fading ([Atkinson et al. 2003](https://doi.org/10.1037/0022-0663.95.4.774)),
  faded faster for experts ([Kalyuga et al. 2003](https://www.tandfonline.com/doi/abs/10.1207/S15326985EP3801_4)).
- Self-explanation ([Bisra et al. 2018](https://link.springer.com/article/10.1007/s10648-018-9434-x);
  [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1)).
- Attempt before instruction for new concepts ([Sinha & Kapur 2021](https://eric.ed.gov/?id=EJ1308129)).
- Measure learning without AI help ([Fan et al. 2025](https://doi.org/10.1111/bjet.13544)).
- Review gaps ([Cepeda et al. 2008](http://wixtedlab.ucsd.edu/publications/wixted/Cepeda_Vul_Rohrer_Wixted_Pashler.pdf));
  total spacing matters more than expanding gaps ([Karpicke & Bauernschmidt 2011](https://learninglab.psych.purdue.edu/downloads/2011/2011_Karpicke_Bauernschmidt_JEPLMC.pdf)).
  Chaining several reviews is an extrapolation from single-review results.
- Product patterns: goal and level first, one question per turn, two tries
  before the answer ([ChatGPT study mode](https://openai.com/index/chatgpt-study-mode/));
  `TODO(human)` handoffs ([Claude Code output styles](https://code.claude.com/docs/en/output-styles));
  escalating hints ([Khanmigo](https://blog.khanacademy.org/khanmigo-math-computation-and-tutoring-updates)).

## Tests

```bash
node --test pi/extensions/learn/*.test.ts
```
