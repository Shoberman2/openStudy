# Question Quality

Question quality is the top priority of the visual chat. This is the rubric and the pipeline. The code is the source of truth: `web/src/engine/tutor/rubric.ts`, `validator.ts`, `pipeline.ts`, `adaptive.ts`.

## The Rubric

Each criterion is scored 1 to 5. A question ships only if every criterion scores at least 3 and the weighted mean is at least 4.

| Criterion | Weight | Passing means |
| --- | --- | --- |
| Tests understanding, not recall | 3 | Answering takes applying, predicting, comparing or explaining. Someone who memorised a definition would not reliably get it right. |
| Plausible distractors | 3 | Every wrong option is a mistake real learners make, and its explanation names that mistake. |
| One unambiguous answer | 3 | An expert picks the same single option without assuming anything the stem leaves out. |
| An explanation for every option | 2 | Each option says why it is right or wrong in terms of the idea. |
| Difficulty matches the level | 2 | The item fits the requested level below. |

Levels: 1 is one idea in a familiar setting. 2 applies it to a new simple example. 3 is two steps or an unfamiliar setting. 4 combines two ideas or predicts what changes. 5 diagnoses a flawed argument or an edge case.

## The Pipeline

Every question from every surface (web chat, all MCP tools) goes through `runPipeline`:

1. **Generate.** The model writes to the rubric. Quiz questions cannot be written in a chat reply: the chat model can only emit a `quiz_request`, which the server sends here.
2. **Validate.** 14 deterministic checks, listed below.
3. **Self-critique.** A separate model call scores each survivor against the rubric as a strict examiner, and works the question itself to catch a wrong key.
4. **Regenerate.** Failed items go back with the specific problems, up to 3 rounds. Anything that still fails is dropped. A question that nobody vouched for (no critique returned) does not pass.

Each quiz carries a report: rounds, items rejected, checks and mean rubric score. The learner sees a one line version under the quiz.

## The Deterministic Checks

| Code | Rejects |
| --- | --- |
| `schema` | Wrong shape, missing field, difficulty outside 1 to 5 |
| `option_count` | Anything other than 4 options |
| `option_ids` | Ids other than a, b, c, d in order |
| `duplicate_options` | Two options that say the same thing, ignoring case and punctuation |
| `correct_count` | Anything other than exactly one correct option |
| `missing_explanation` | An option with no real explanation |
| `copied_explanation` | Two options sharing an explanation |
| `catch_all_option` | "All of the above", "none of these", "both A and B" |
| `answer_in_stem` | The stem contains the answer |
| `word_clue` | A distinctive stem word repeated only in the right answer |
| `explanation_in_stem` | The stem contains the explanation |
| `length_balance` | A right answer over 1.75 times the longest wrong one (and 12+ characters longer) |
| `not_a_question` | A stem that does not end in a question mark or colon |
| `negative_stem` | A lower case "not", "except" or "never" in the stem |

## Adaptivity

Mastery is explicit, per concept, and shown in plain words. `nextLevel` looks at the last 5 answers on a concept. At least 3 answers are needed before it moves. 80 percent or better moves up a level, 40 percent or lower moves down, and everything else holds. The quiz states the reason, for example "Moved up to level 4: you got 4 of your last 5 right". The web keeps attempts in localStorage. MCP clients pass them back in through `attempts`.

`masteryScore` weighs recent answers more, rewards a hard right answer over an easy one, and cannot reach full marks from fewer than 3 attempts. It orders the weakest concepts for study plans and the model.

## Demo Mode

With no AI key, questions come from hand-written packs (`demo-packs.ts`) and still run through the same pipeline. The critic is then a labelled heuristic (`demoCritic`) that can only judge what the text shows, so the quiz says "demo critic". All 25 pack questions are pinned by tests to pass the validator.
