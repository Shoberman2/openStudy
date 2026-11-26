// Run from web with npm run pretest && npx tsx scripts/audit-questions.mts.
import { readFileSync } from "node:fs";
import { buildProject } from "../src/engine/classbuilder";
import type { Exercise } from "../src/engine/exercises";
import { readTextFile } from "../src/engine/formats";
import { emptyLibrary, materialize } from "../src/engine/library";
import { buildSession } from "../src/engine/session";
import type { ProjectType } from "../src/engine/types";

const sources: { file: string; type: ProjectType }[] = [
  { file: "r-basics.md", type: "class" },
  { file: "algorithms.md", type: "other" },
  { file: "mit-6006-notes.md", type: "class" },
];
const now = new Date(2026, 10, 23, 10);

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function details(ex: Exercise): string {
  const choices = (options: string[]) => ` | Options: ${JSON.stringify(options)}`;
  switch (ex.type) {
    case "mc": return `${[...(ex.context ?? []), ex.prompt].join(" / ")} | Answer: ${ex.answer}${choices(ex.options)}`;
    case "def-mc": return `Pick what it means: ${ex.term} | Answer: ${ex.answer}${choices(ex.options)}`;
    case "term-type": return `Type from memory: ${ex.definition} | Answer: ${ex.answer}`;
    case "type": return `${ex.prompt} | Answer: ${ex.answer}`;
    case "bank": return `${ex.segments.map((s) => typeof s === "string" ? s : "____").join("")} | Answer: ${ex.answers.join(", ")}${choices(ex.options)}`;
    case "tf": return `${ex.statement} | Answer: ${ex.truth ? "True" : "False"}${choices(["True", "False"])}`;
    case "match": {
      const pair = (key: string) => ex.pairs.find((p) => p.key === key)!;
      return `Match the pairs | Answer: ${ex.pairs.map((p) => `${p.term} = ${p.clue}`).join(" / ")}${choices([...ex.terms.map((key) => pair(key).term), ...ex.clues.map((key) => pair(key).clue)])}`;
    }
    case "explain": return `Explain ${ex.topic} | Answer: ${ex.sources.join(" / ")}`;
    case "apply": return `How would you use this? ${ex.statement} | Answer: Free response`;
    default: throw new Error(`Unexpected exercise in text audit: ${ex.type}`);
  }
}

for (const { file, type } of sources) {
  const content = readFileSync(new URL(`../src/engine/fixtures/${file}`, import.meta.url), "utf8");
  const pages = readTextFile(file, content).pages.map((p, i) => ({ ...p, id: String(i), sourceName: file }));
  const built = buildProject({ title: file.replace(/\.md$/, ""), type }, pages);
  const { lessons, cards } = materialize(file, built, [], { now });
  const rand = seeded(23);
  let count = 0;
  console.log(`\n## ${file} (${type})`);
  // First pass at level 0 in lesson order, then replay at the next level as needed.
  for (let level = 0; level <= 5 && count < 30; level++) {
    for (const lesson of lessons) {
      if (count >= 30) break;
      const session = buildSession({ ...lesson, level }, cards, emptyLibrary().profile, now, rand, cards, { projectType: type });
      for (const ex of session.slice(0, 30 - count)) {
        console.log(`${++count}. [L${level} ${lesson.title} | ${ex.type}${ex.type === "mc" && ex.form ? `/${ex.form}` : ""}] ${details(ex)}`);
      }
    }
  }
  console.log(`Served ${count} / 30`);
}
