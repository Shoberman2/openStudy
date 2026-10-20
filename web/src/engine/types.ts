// Library v1 (shared/SPEC.md section 2). Identical on web and iOS.

export type Bringing = "books" | "class" | "anything";
/** Values written by v1 clients; mapped to ["books"] on load. */
export type LegacyBringing = "screenshots" | "notes" | "both";
export type Goal = "ideas" | "facts" | "quotes" | "apply";
export type PracticePref = "tap" | "blank" | "type" | "flash";
export type DailyGoal = 10 | 20 | 30 | 50;

export type Profile = {
  onboarded: boolean;
  /** Shown on the Profile screen (spec 11.3). */
  name?: string;
  bringing: Bringing[];
  /** Exam date from onboarding, applied to the first class project created (then cleared). */
  pendingGoalDate?: string;
  goals: Goal[];
  practice: PracticePref[];
  dailyGoalXP: DailyGoal;
  reminder?: string;
};

export type Stats = {
  xp: number;
  streak: number;
  longestStreak: number;
  lastActiveDay?: string;
  freezes: number;
  dayXP: Record<string, number>;
};

export type ProjectColor = "blue" | "red" | "yellow" | "green" | "ink";
export const PROJECT_COLORS: ProjectColor[] = ["blue", "red", "yellow", "green", "ink"];

export type Project = {
  id: string;
  title: string;
  author?: string;
  color: ProjectColor;
  createdAt: string;
  focus: "ideas" | "ideas+quotes";
  quotesAsked: boolean;
  sample?: boolean;
  type?: ProjectType;
  goalDate?: string;
  minutesPerDay?: number;
  /** Subject shelf, e.g. "Biology" (spec 9.4). */
  category?: string;
};

export type ProjectType = "book" | "class" | "other";

export type PageKind = "screenshot" | "note" | "photo" | "pdf" | "slides" | "doc";

export type Page = {
  id: string;
  projectId: string | null;
  kind: PageKind;
  text: string;
  sourceName?: string;
  sourceIndex?: number;
  /** PDF/PPTX metadata title of the source file, used to name the file's unit. */
  sourceTitle?: string;
  heading?: string;
  verbatim?: boolean;
  header?: string;
  suggestedTitle?: string;
  suggestedAuthor?: string;
  image?: string;
  assetId?: string;
  /** Apple Notes folder and note id (spec 9.1). */
  folder?: string;
  noteId?: string;
  /** The page is a word list (spec 10.2). */
  words?: WordEntry[];
  /** dHash of the image, 16 hex chars (spec 10.3). */
  imageHash?: string;
  /** Printed page number read from a screenshot (spec 10.5). */
  pageNumber?: number;
  createdAt: string;
};

export type WordEntry = { term: string; definition?: string };

export type Lesson = {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  kind: "theme" | "quotes";
  order: number;
  level: number;
  sessions: number;
};

export type Srs = {
  state: "new" | "learning" | "review";
  ease: number;
  interval: number;
  due: string;
  reps: number;
  lapses: number;
};

export type Card = {
  id: string;
  lessonId: string;
  projectId: string;
  pageId?: string;
  /** "picture": a photo or diagram page to recall from the image (spec 11.2). */
  kind: "fact" | "quote" | "picture";
  statement: string;
  cloze?: string;
  question?: string;
  answer?: string;
  distractors?: string[];
  falseStatement?: string;
  attribution?: string;
  term?: string;
  definition?: string;
  srs: Srs;
};

export type LibEvent = {
  t: string;
  name: string;
  props?: Record<string, string | number | boolean>;
};

export type Library = {
  version: 1;
  profile: Profile;
  stats: Stats;
  projects: Project[];
  pages: Page[];
  lessons: Lesson[];
  cards: Card[];
  events: LibEvent[];
};

export type Grade = "again" | "hard" | "good" | "easy";
