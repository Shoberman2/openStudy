"use client";

// "Worth Practicing First" (spec 18): up to three ideas from the pile, each with the sentence it came from.
import type { StudyIdea } from "@/engine/salience";

export function StudyShortlist({
  from,
  ideas,
  starting,
  onStart,
}: {
  from: string;
  ideas: StudyIdea[];
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <section className="mb-12" aria-label="Worth Practicing First" data-testid="shortlist">
      <h1 className="text-[32px] font-black leading-tight tracking-tight">Worth Practicing First</h1>
      <p className="mt-1 text-[16px] text-muted">From {from}</p>
      <ul className="mt-5 grid grid-cols-1 gap-3">
        {ideas.map((idea) => (
          <li key={idea.key} className="rounded-[16px] bg-shelf px-4 py-3">
            <span className={`block text-[18px] font-extrabold ${idea.typed && /[^A-Za-z\s]/.test(idea.title) ? "font-mono" : ""}`}>{idea.title}</span>
            <span className="mt-1 block text-[16px] text-muted">{idea.source.length > 180 ? `${idea.source.slice(0, 177).trimEnd()}...` : idea.source}</span>
          </li>
        ))}
      </ul>
      <button className="btn btn-block mt-5" onClick={onStart} disabled={starting} aria-busy={starting}>
        {starting ? "Building your drill" : "Start this drill"}
      </button>
    </section>
  );
}
