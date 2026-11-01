# OpenStudy iOS: Design

Follows `spencer-web-style` and `spencer-app-style` (github.com/Shoberman2/design-rules). This file
records the OpenStudy choices and only overrides those rules where it says so.

## Brand

- **Accent: none.** Ink `#1A1A18` (dark `#F2F2EF`) is the accent: primary button, links, focus, state.
- **Ground:** pure white `#FFFFFF`; dark `#0E0E10` with surfaces `#17171A` / `#1F1F23`.
- **Font:** Geist (Regular, Medium, SemiBold, Bold), bundled in `OpenStudy/Resources/Fonts`, Dynamic
  Type through `Font.custom(_:size:relativeTo:)`. Geist Mono only for numbers (streak, XP, minutes, stats).
- **Tokens:** every color and font lives in `OpenStudy/Design/Theme.swift`. No hex in components.
- **Book spines and lesson nodes** use five quiet ink tones instead of hues. The stored color names
  (`blue`, `red`, ...) stay in the library file so web and iOS files keep working.
- **Dark mode:** follows the system, override in the Settings sheet (System, Light, Dark).

## Character: Ollie (placeholder name, rename freely)

- **Ollie** is a small ink owl with round reading glasses, drawn as vector art in
  `OpenStudy/Design/Mascot.swift` (no image files, never on a background).
- **To rename:** change `Mascot.name` in `Mascot.swift` and this section. Every line of copy reads the
  constant.
- Moods: neutral, happy, thinking, reading, sleepy. In dark mode Ollie is a pale snowy owl with dark
  eyes (designed, not inverted).
- Ollie appears in: the onboarding chat (blinks now and then, off with Reduce Motion), empty states,
  "Writing questions", the paywall, the lesson complete screen, and the study check.
- **App icon** is Ollie on white (dark variant on `#0E0E10`). The launch screen shows Ollie alone.
  To regenerate, render `OwlView` at 1024pt (see the commit that added the icon).

## Navigation

- **Choice: one home screen plus pushed detail, no tab bar.** OpenStudy is content-led but small: Home
  (today's plan, continue, practice, shelf, ask) holds everything; a study set opens its path, and Sort
  and the full plan push on top. Tabs would add three thin pages for no gain.
- **Sheets:** Settings, Profile and Study Check open as sheets (`.presentationDetents`). The paywall
  is a full-screen cover because it carries required purchase terms.
- **No landing page:** the app opens straight into the chat with Ollie, then the product.

## Onboarding

A chat with Ollie, one question at a time, tap-only, five steps: what you study, what you want from
it, time a day, account (Sign in with Apple above email, or Later), first material. Practice formats
default to a mix (taps, fill-ins, typing) and are editable in Settings; the exam date is set per study
set.

## Gamification

- **Choice: light.** Kept from the existing product: a day streak count, the daily goal ring, lesson
  levels shown as five-segment rings, a checkmark for correct answers, and the XP count on lesson
  complete. **No** confetti, badges, leaderboards, party emoji or sounds. The combo flame shows from
  three in a row, in ink.

## Signature moment

Lesson complete: Ollie looks up happy while the XP number rolls up and the goal ring fills.

## AI output

Anything a model wrote (concept questions from the writer, Ask answers, smart organize) carries
"AI-generated · Not medical or research advice". The study check is deterministic and says "Based on
your own study history. Not medical or research advice."

## Rejected ideas (do not bring back)

- Duolingo-style chunky buttons with bottom lips, blue primary, yellow XP and streak (v1 to v7 look).
- Rounded system font and serif book text (one face now: Geist).
- Icons in tinted circles on plan rows, boxed stat grids, divider lines between rows.
- A welcome landing screen with the blurred lesson path behind it.
