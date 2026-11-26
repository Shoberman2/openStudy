// Code and syntax in class notes (spec 16). Notes for programming classes (R, Python, algorithms)
// describe code in sentences like "head(df) returns the first six rows" or "The pipe operator %>%
// passes ...". Those become syntax cards: the code is the term, what it does is the definition, so
// "Type the term" asks the learner to write the code from memory.
import { escapeRegExp } from "./text";

export type CodeDefinition = { term: string; definition: string };

/** Characters that only show up in code, never in a plain-English term. */
const CODE_CHARS = /[()[\]{}<>=%$~^|&\\`]|::|->|<-/;
const CONSTANTS = ["NA", "NULL", "TRUE", "FALSE", "None", "NaN", "Inf"];

/** True when a term is code, so it keeps its exact spelling. */
export function isCode(term: string | undefined): boolean {
  return !!term && (CODE_CHARS.test(term) || CONSTANTS.includes(term));
}

// A call with up to one level of nested parentheses: head(df), install.packages("dplyr"),
// mean(x, na.rm = TRUE), ggplot(df, aes(x = a)) + geom_point(), obj.append(x).
const CALL = String.raw`[A-Za-z_.][\w.]*\((?:[^()]|\([^()]*\))*\)`;
const CHAIN = String.raw`${CALL}(?:\s*(?:\+|%>%|\|>|\.|\bfollowed\s+by\b)\s*${CALL})*`;
const LEAD_CODE = new RegExp(String.raw`^(${CHAIN}|${CONSTANTS.join("|")})\s+(is|are|means|[a-z]+s)\s+(.+)$`);
const CODE_CONTEXT = /\b(?:in R|RStudio|Python|NumPy|pandas|programming|sentinel|missing values?|logical values?|boolean|numeric values?|infinite values?|not a number|null object)\b/i;
// "The pipe operator %>% passes ...", "The $ operator selects ...".
const NAMED_OP = /^the\s+(?:([a-z]+(?:\s[a-z]+)?)\s+operator\s+(\S+)|(\S+)\s+operator)\s+(?:in\s+\w+\s+)?(is|are|means|[a-z]+s)\s+(.+)$/i;
// "The assignment operator in R is <-".
const OP_IS = /^the\s+([a-z]+(?:\s[a-z]+)?)\s+operator(\s+in\s+\w+)?\s+is\s+(\S+?)[,.]?(?:\s|$)/i;

const SKIP_VERBS = new Set(["was", "has", "does", "this", "its", "always", "sometimes", "less", "unless", "thus", "plus"]);

function cleanDefinition(def: string, term: string): string | null {
  let d = def.trim();
  // "..., for example c(1, 2, 3)" gives the answer away; drop the example.
  const name = term.match(/^[A-Za-z_.][\w.]*/)?.[0] ?? term;
  const ex = d.search(/[,;(]?\s*(?:for example|for instance|e\.g\.|such as)\b/i);
  if (ex > 0 && new RegExp(escapeRegExp(name)).test(d.slice(ex))) d = d.slice(0, ex);
  d = d.replace(/[.;,\s]+$/, "");
  if (term && d.includes(term)) return null;
  const words = d.split(/\s+/).filter(Boolean).length;
  if (words < 3 || words > 40) return null;
  return d;
}

/** A syntax definition, or null when the sentence does not lead with code. */
export function detectCodeDefinition(line: string): CodeDefinition | null {
  const s = line.trim().replace(/^[-*•\s]+/, "");
  const lead = s.match(LEAD_CODE);
  if (lead && !SKIP_VERBS.has(lead[2]) && (!CONSTANTS.includes(lead[1]) || CODE_CONTEXT.test(lead[3]))) {
    const verb = lead[2];
    const rest = /^(is|are|means)$/i.test(verb) ? lead[3] : `${verb} ${lead[3]}`;
    const definition = cleanDefinition(rest, lead[1]);
    if (definition) return { term: lead[1].trim(), definition: capFirst(definition) };
  }
  const opIs = s.match(OP_IS);
  if (opIs && isCode(opIs[3]) && opIs[3].length <= 6) {
    return { term: opIs[3], definition: `The ${opIs[1].toLowerCase()} operator${opIs[2] ?? ""}` };
  }
  const named = s.match(NAMED_OP);
  if (named) {
    const term = named[2] ?? named[3];
    const verb = named[4];
    if (term && isCode(term) && term.length <= 6 && !SKIP_VERBS.has(verb.toLowerCase()) && !/^(is|are|means)$/i.test(verb)) {
      const definition = cleanDefinition(`${verb} ${named[5]}`, term);
      if (definition) return { term, definition: capFirst(definition) };
    }
  }
  return null;
}

const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Code answers compare exactly except for spacing and quote style (R and Python accept either quote). */
export function normalizeCode(s: string): string {
  return s
    .trim()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s*([()[\]{},=+*/<>|&!$~^:;-]|%>%)\s*/g, "$1")
    .replace(/[.;]+$/, "");
}

// Keep string contents intact and tokenize before ignoring spacing so split operators stay split.
// Escaped strings keep their original quotes unless the forms are identical.
const CODE_TOKEN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|[\p{L}_][\p{L}\p{N}_.]*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[\p{L}_]*|%[^%\s]+%|::[:]?|<<?-|->>?|\|>|\*\*|\/\/|<<|>>|[<>=!]=|&&|\|\||[^\s]/gu;

export function typedCodeTokens(code: string): string[] {
  const parts = code.match(CODE_TOKEN) ?? [];
  // An optional statement terminator after a call or a literal neither changes its arguments nor adds code.
  if (parts.at(-1) === ";" && (parts.at(-2) === ")" || CONSTANTS.includes(parts.at(-2) ?? ""))) parts.pop();
  return parts.map((part) => /^(['"])[^'"\\]*\1$/.test(part) ? `'${part.slice(1, -1)}'` : part);
}

/**
 * True when `word` (a candidate fill-in word) appears in `text` first as part of code, like
 * "packages" in install.packages("dplyr") or "group" in group_by(). Blanking it would test a
 * fragment of a name, not the idea.
 */
export function onlyInCode(text: string, word: string): boolean {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu");
  // Blanking replaces the first occurrence, so that is the one that must be plain text.
  const m = re.exec(text);
  if (!m) return false;
  const start = m.index + m[1].length;
  const before = text[start - 1] ?? "";
  const after = text[start + word.length] ?? "";
  return /[._$"'@]/.test(before) || /[_("'@]/.test(after) || (after === "." && /\w/.test(text[start + word.length + 1] ?? ""));
}
