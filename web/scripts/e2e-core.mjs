// End-to-end check of the core study flow in a real browser (spec 6, 8 and 16), against a running
// server: onboarding, import a notes file, sort, create the project, open it, play a lesson to the
// end, then confirm the progress shows on Home and that typed code is graded.
//
// Usage: npm run build && npx next start -p 3100   (in another terminal)
//        npm run e2e                                (or E2E_URL=https://<preview> npm run e2e)
//        Protected preview: E2E_VERCEL_AUTH=1 E2E_URL=https://<preview> node --env-file=.env.local scripts/e2e-core.mjs
// Uses playwright-core with the Chromium that Playwright installed (npx playwright install chromium).
import { chromium } from "playwright-core";

const BASE = (process.env.E2E_URL ?? "http://localhost:3100").replace(/\/$/, "");
const HEADLESS = process.env.E2E_HEADED !== "1";

const R_NOTES = `# R Basics

The assignment operator in R is <-, for example x <- 5 stores 5 in x.
c() combines values into a vector, for example c(1, 2, 3).
A data frame is a table where each column is a vector of the same length.
str(df) shows the structure of a data frame, including column types.
head(df) returns the first six rows of a data frame.
summary(df) gives the minimum, quartiles, mean and maximum of each numeric column.
The $ operator selects one column of a data frame, for example df$age.
R indexes vectors starting at 1, not 0.

# The Tidyverse

install.packages("dplyr") downloads a package from CRAN once.
library(dplyr) loads an installed package into the current session.
filter() keeps the rows of a data frame that match a condition.
select() keeps only the columns you name.
mutate() adds new columns or changes existing ones.
The pipe operator %>% passes the result on its left into the function on its right.
`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// Protected Vercel previews: E2E_VERCEL_AUTH=1 with VERCEL_OIDC_TOKEN (vercel env pull) sends the
// short-lived token, only to the preview's own origin, as Vercel's Trusted Sources header.
if (process.env.E2E_VERCEL_AUTH === "1" && process.env.VERCEL_OIDC_TOKEN) {
  const token = process.env.VERCEL_OIDC_TOKEN;
  await ctx.route(`${BASE}/**`, (route) => route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": token } }));
}
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const click = (name) => page.getByRole("button", { name, exact: true }).click();
const textOf = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

// All reads/writes use the isolated Playwright browser context created above.
const fixture = (projectId, makeReady = false) => page.evaluate(async ({ projectId, makeReady }) => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("openstudy");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("library", makeReady ? "readwrite" : "readonly");
      const store = tx.objectStore("library");
      let lessonIds;
      tx.oncomplete = () => resolve(lessonIds);
      tx.onerror = () => reject(tx.error);
      const req = store.get("library-v1");
      req.onsuccess = () => {
        const lib = req.result;
        const lessons = lib.lessons.filter((l) => l.projectId === projectId).sort((a, b) => a.order - b.order);
        lessonIds = lessons.map((l) => l.id);
        if (!makeReady) return;
        for (const l of lessons.slice(0, 2)) l.level = 3;
        const c = lib.cards.find((card) => card.projectId === projectId);
        c.srs = { ...c.srs, state: "review", due: new Date(0).toISOString() };
        store.put(lib, "library-v1");
      };
    });
  } finally {
    db.close();
  }
}, { projectId, makeReady });

try {
  // 1. Landing.
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.getByText("Anything you want to learn, turned into lessons.").waitFor();
  check("landing renders", true, `${Date.now() - t0} ms`);

  // 2. Onboarding (spec 6.2 / 8.6).
  await page.goto(`${BASE}/app`);
  await page.waitForURL(/\/app\/welcome/);
  await page.getByRole("button", { name: /^Classes/ }).click();
  await click("Continue");
  await page.getByRole("button", { name: /^Not yet/ }).click();
  await click("Continue");
  await page.getByRole("button", { name: "Know the facts cold" }).click();
  await click("Continue");
  await page.getByRole("button", { name: /^Type it from memory/ }).click();
  await click("Continue");
  await page.getByRole("button", { name: /^Regular/ }).click();
  await click("Continue");
  await page.getByRole("button", { name: /^Import files/ }).click();
  await page.waitForURL(/\/app\/import/);
  check("onboarding", true);

  // 3. Import a notes file (spec 8.2).
  await page.locator('input[type="file"]').setInputFiles({ name: "r-basics.md", mimeType: "text/markdown", buffer: Buffer.from(R_NOTES) });
  await page.getByText(/Added \d+ pages? from 1 file/).first().waitFor({ timeout: 20_000 });
  check("import notes file", true);

  // 4. Sort and create (spec 3.3 / 9.6). Accounts off or comped: no paywall in the way.
  await page.getByRole("link", { name: "Sort pages" }).click();
  await page.waitForURL(/\/app\/sort/);
  await page.getByRole("button", { name: /^Create (project|all)/ }).first().waitFor();
  // The category is an editable field, so read input values, not page text.
  const fields = await page.locator("input").evaluateAll((els) => els.map((e) => e.value));
  check("sort suggests a Computer Science project", fields.includes("Computer Science"), fields.filter(Boolean).join(", "));
  check("sort uses the file name for the project title", fields.includes("R-basics"));
  await page.getByRole("button", { name: /^Create (project|all)/ }).first().click();
  await page.waitForURL((u) => /\/app(\/p\/[^/]+)?$/.test(u.pathname), { timeout: 20_000 });
  const paywalled = (await textOf()).includes("Start free trial");
  check("project created without a dead-end paywall", !paywalled);

  // 5. Project screen: answer the focus sheet, open the first lesson.
  await page.goto(`${BASE}/app`);
  await page.locator('a[href^="/app/p/"]').first().waitFor();
  const projectHref = await page.locator('a[href^="/app/p/"]').first().getAttribute("href");
  const projectId = projectHref.split("/").pop();
  await page.goto(`${BASE}${projectHref}`);
  await page.getByText(/Opens when 2 lessons reach level 3/).waitFor();
  await page.goto(`${BASE}${projectHref.replace("/app/p/", "/app/test/")}`);
  const back = page.getByRole("link", { name: "Back to project" });
  const locked = page.getByText("Reach level 3 in 2 lessons to take your practice test.");
  await locked.or(page.getByRole("button", { name: "Next", exact: true })).first().waitFor();
  const directTestLocked = await locked.isVisible() && await back.isVisible();
  check("direct practice test link respects the project lock", directTestLocked);
  if (directTestLocked) await back.click();
  else await page.goto(`${BASE}${projectHref}`);
  await page.locator('section[aria-label="Lesson path"] button').first().waitFor();
  await page.waitForTimeout(500);
  const everything = page.getByRole("button", { name: "Everything", exact: true });
  if (await everything.isVisible().catch(() => false)) await everything.click();
  const [, secondLessonId] = await fixture(projectId);
  await page.goto(`${BASE}/app/learn/${secondLessonId}`);
  const lessonLocked = page.getByText("Finish the previous lesson to start this one.");
  await lessonLocked.or(page.getByRole("button", { name: "Check", exact: true })).first().waitFor();
  const directLessonLocked = await lessonLocked.isVisible();
  check("direct lesson link respects the path lock", directLessonLocked);
  if (directLessonLocked) await page.getByRole("link", { name: "Back to the path" }).click();
  else await page.goto(`${BASE}${projectHref}`);
  await page.locator('section[aria-label="Lesson path"] button').first().click();
  await page.locator('a[href^="/app/learn/"]').first().waitFor();
  const learnHref = await page.locator('a[href^="/app/learn/"]').first().getAttribute("href");
  check("lesson path opens a lesson", !!learnHref);

  // 6. Play the lesson to the end. Unknown questions get a guess; the feedback panel shows the
  //    right answer, which is remembered for when the question comes back (mistakes re-queue).
  await page.goto(`${BASE}${learnHref}`);
  await page.getByRole("button", { name: "Check", exact: true }).waitFor({ timeout: 20_000 });
  const memory = new Map();
  let syntaxPrompts = 0;
  let done = false;
  for (let step = 0; step < 120 && !done; step++) {
    const body = await textOf();
    if (/XP earned/.test(body) && /Accuracy/.test(body)) {
      done = true;
      break;
    }
    const key = body.split(/ 1 /)[0].slice(0, 160);
    if (/Pick what it does|Which code|Write the code/.test(body)) syntaxPrompts++;
    const known = memory.get(key);
    if (/^.{0,40}Match the pairs/.test(body)) {
      const tiles = await page.locator("button.tile").all();
      const half = tiles.length / 2;
      for (let i = 0; i < half; i++) {
        for (let j = half; j < tiles.length; j++) {
          if (!(await tiles[i].isEnabled()) || !(await tiles[j].isEnabled())) continue;
          await tiles[i].click();
          await tiles[j].click();
          await page.waitForTimeout(450);
          if (!(await tiles[i].isEnabled())) break;
        }
      }
    } else if (await page.getByRole("button", { name: "Compare with the source" }).isVisible().catch(() => false)) {
      await page.getByLabel("Your explanation").fill("I would use this when I write R code to clean and look at a data set for class.");
      await click("Compare with the source");
      await click("Got it");
    } else if (await page.getByLabel("Your answer").isVisible().catch(() => false)) {
      await page.getByLabel("Your answer").fill(known ?? "x");
      await click("Check");
    } else if (await page.locator("button.chip:not(.is-used)").first().isVisible().catch(() => false)) {
      const chips = await page.locator("button.chip:not(.is-used)").all();
      let picked = false;
      for (const c of chips) {
        if (known && (await c.innerText()).trim() === known) {
          await c.click();
          picked = true;
        }
      }
      if (!picked) await chips[0].click();
      const checkBtn = page.getByRole("button", { name: "Check", exact: true });
      if (await checkBtn.isEnabled()) await checkBtn.click();
      else continue;
    } else {
      const tiles = await page.locator("button.tile").all();
      let picked = false;
      for (const t of tiles) {
        const label = (await t.innerText()).replace(/^\d\s*/, "").trim();
        if (known && label === known) {
          await t.click();
          picked = true;
        }
      }
      if (!picked && tiles[0]) await tiles[0].click();
      await click("Check");
    }
    const status = page.locator('[role="status"]');
    await status.waitFor({ timeout: 5000 }).catch(() => undefined);
    const s = (await status.innerText().catch(() => "")).replace(/\s+/g, " ");
    const m = s.match(/Correct answer:\s*(.+?)(?:\s*From .*|\s*Continue.*)?$/);
    if (m) memory.set(key, m[1].trim());
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  check("lesson plays to the end", done);
  check("syntax questions asked about the code", syntaxPrompts > 0, `${syntaxPrompts} seen`);
  await click("Continue");

  // 7. Progress shows on Home.
  await page.goto(`${BASE}/app`);
  await page.getByText(/\d+ XP/).first().waitFor();
  const home = await textOf();
  const xp = Number(home.match(/(\d+) XP/)?.[1] ?? 0);
  check("XP recorded on Home", xp > 0, `${xp} XP`);

  // 8. Put the isolated browser fixture at the eligibility threshold and make one review due.
  await fixture(projectId, true);
  await page.evaluate(() => localStorage.setItem("os-debug", "1"));
  await page.goto(`${BASE}/app/plan`);
  const today = page.getByTestId("plan-day").first();
  await today.getByRole("heading", { name: "Today" }).waitFor();
  const review = today.getByRole("link", { name: /Review 1 card/ });
  await review.waitFor();
  check("today's plan links to due practice", (await review.getAttribute("href")) === "/app/practice");
  await review.click();
  await page.getByRole("button", { name: "Check", exact: true }).waitFor();
  check("practice opens a due review", true);
  await page.goto(`${BASE}${projectHref}`);
  await page.getByTestId("practice-test").click();
  await page.getByRole("progressbar", { name: "Test progress" }).waitFor();
  check("practice test opens at two ready lessons", true);

  // Complete the test with one deliberate miss and open the focused review.
  const advance = page.getByRole("button", { name: /^(Next|Finish test)$/ });
  let previous;
  for (let i = 0; i < 20; i++) {
    await page.waitForFunction((last) => window.__osEx && window.__osEx.id !== last, previous);
    const ex = await page.evaluate(() => window.__osEx);
    previous = ex.id;
    if (ex.type === "type" || ex.type === "term-type") {
      await page.getByLabel("Your answer").fill(i === 0 ? "not-a-correct-answer" : ex.answer);
    } else if (ex.type === "tf") {
      await page.getByRole("button", { name: (ex.truth !== (i === 0)) ? /True/ : /False/ }).click();
    } else {
      const answer = i === 0 ? ex.options.find((o) => o !== ex.answer) ?? ex.answer : ex.answer;
      await page.locator("button.tile").getByText(answer, { exact: true }).first().click();
    }
    const last = await advance.innerText() === "Finish test";
    await advance.click();
    if (last) break;
  }
  await page.getByRole("heading", { name: "Practice test done" }).waitFor();
  check("practice test scores each lesson", await page.getByRole("region", { name: "Accuracy by lesson" }).locator("li").count() === 2);
  await click("Review your misses");
  await page.getByRole("button", { name: "Check", exact: true }).waitFor();
  check("practice test opens review of misses", true);

  // 9. Pages that must always load.
  for (const p of ["/app/plan", "/app/practice", "/app/profile", "/app/settings", "/app/import", "/privacy", "/terms"]) {
    const r = await page.goto(`${BASE}${p}`);
    check(`GET ${p}`, !!r && r.ok());
  }
  await page.goto(`${BASE}/api/health`);
  const health = JSON.parse(await page.locator("body").innerText());
  check("/api/health answers", typeof health.ai === "boolean", JSON.stringify(health));

  const real = errors.filter((e) => !/favicon/i.test(e));
  check("no console errors", real.length === 0, real.slice(0, 3).join(" | "));
} catch (e) {
  check("flow finished without an exception", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
