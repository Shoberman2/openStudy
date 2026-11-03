# ChatGPT learning visuals: teardown (Nov 2026)
Sources: help.openai.com/en/articles/11780217 (study mode), openai.com/index/new-ways-to-learn-math-and-science-in-chatgpt (Mar 10 2026), help.openai.com/en/articles/20001533 (flashcards), edunewsletter.openai.com/p/the-edu-prompt-issue-6 (@Visualize, quizzes), developers.openai.com/apps-sdk/mcp-apps-in-chatgpt.

What ChatGPT does
- Study mode: Socratic guidance, hints, layered explanations, knowledge checks, one-question-at-a-time quizzing, some memory of past sessions, progress tracking.
- Interactive visual explanations: ~70 fixed math/science topics (Pythagorean theorem, PV=nRT, Ohm's law, compound interest...) with sliders that update graphs live. Curated, not general.
- @Visualize: user-prompted generated interactive visualizations.
- Flashcards: in-response deck, flip, known/unknown, shuffle, saved to library.
- Quizzes: interactive quiz shortcut; availability varies.
- Apps SDK / MCP Apps: third-party tools can render iframe widgets (_meta.ui.resourceUri, text/html;profile=mcp-app; legacy openai/outputTemplate).

Weaknesses to beat
- Visuals limited to a fixed topic list; elsewhere falls back to text or static images.
- Question quality not guaranteed: no visible rubric, distractors often weak, recall-heavy, explanations usually only for the correct answer.
- Difficulty adaptation is implicit and opaque; no explicit mastery model per concept.
- Worked solutions are a wall of text; no step-by-step reveal or "try next step first".
- No concept maps; flashcards and quizzes are separate features rather than one study loop.
- Admits it may just give the answer directly.
