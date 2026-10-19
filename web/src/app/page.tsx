import { existsSync } from "node:fs";
import path from "node:path";
import { ArrowRight, ArrowDown, Smartphone } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/basics";
import { HeroDemo, QuotesDemo } from "@/components/landing/Demos";
import { IPhoneFrame, PlanVisual, ShelfVisual, SourcesStack } from "@/components/landing/Visuals";

export const dynamic = "force-static";

function shot(name: string): string | null {
  return existsSync(path.join(process.cwd(), "public", name)) ? `/${name}` : null;
}

function Arrow() {
  return (
    <div className="flex items-center justify-center lg:h-[400px] text-[var(--line-strong)]" aria-hidden>
      <ArrowRight className="hidden lg:block" size={30} strokeWidth={2.75} />
      <ArrowDown className="lg:hidden" size={30} strokeWidth={2.75} />
    </div>
  );
}

export default function Landing() {
  const home = shot("ios-home.png");
  const pathShot = shot("ios-path.png");
  const lesson = shot("ios-lesson.png");
  return (
    <div className="overflow-x-hidden">
      <header className="mx-auto flex h-[72px] w-full max-w-[1120px] items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href="#ios" className="hidden rounded-[12px] px-3 py-2 font-bold text-muted hover:text-ink sm:block">
            iPhone app
          </a>
          <Link href="/app" className="btn btn-sm">
            Start studying
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto w-full max-w-[1120px] px-4 pt-8 sm:px-6 sm:pt-14">
          <div className="mx-auto max-w-[760px] text-center">
            <h1 className="display text-[40px] min-[400px]:text-[44px] lg:text-[48px]">Anything you want to learn, turned into lessons.</h1>
            <p className="mx-auto mt-5 max-w-[600px] text-[18px] leading-relaxed text-muted sm:text-[19px]">
              Drop in book screenshots, class slides, PDFs, or a photo of the whiteboard. OpenStudy sorts it, builds the lessons, and plans your study days until it sticks.
            </p>
            <div className="mx-auto mt-8 grid max-w-[460px] grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <Link href="/app" className="btn btn-block">
                Start studying
              </Link>
              <a href="#ios" className="btn btn-secondary btn-block">
                <Smartphone size={20} strokeWidth={2.5} /> Get the iPhone app
              </a>
            </div>
          </div>

          <div className="mt-12 rounded-[32px] bg-shelf px-4 py-8 sm:mt-16 sm:px-10 sm:py-12">
            <div className="mx-auto flex max-w-[940px] flex-col items-center gap-10 lg:flex-row lg:items-center lg:justify-center lg:gap-14">
              <div className="w-full max-w-[520px]">
                <p className="kicker mb-3 text-center lg:text-left">Try it. This is a live lesson from the samples.</p>
                <HeroDemo />
              </div>
              <div className="flex flex-col items-center">
                <IPhoneFrame src={home} alt="OpenStudy home screen on iPhone" width={264} />
                <p className="mt-4 text-[14px] font-bold text-muted">The same library on iPhone</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1120px] px-4 pt-20 sm:px-6 sm:pt-28">
          <h2 className="text-center text-[30px] font-black leading-tight tracking-tight sm:text-[36px]">From whatever you saved to a study plan</h2>
          <p className="mx-auto mt-3 max-w-[580px] text-center text-muted">
            A book page, a lecture slide, a photo of the whiteboard. Each lands on its project, becomes lessons, and fits into your days.
          </p>
          <div className="mt-12 grid items-start gap-6 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-4">
            <figure>
              <div className="flex items-center justify-center py-2 lg:h-[400px] lg:py-0">
                <SourcesStack bookText="You can make more friends in two months by becoming interested in other people than you can in two years by trying to get other people interested in you. Smile. Remember that a person's name is to that person the sweetest sound." />
              </div>
              <figcaption className="mt-4 text-center font-extrabold">What you saved</figcaption>
            </figure>
            <Arrow />
            <figure>
              <div className="flex items-center justify-center py-2 lg:h-[400px] lg:py-0">
                <ShelfVisual />
              </div>
              <figcaption className="mt-4 text-center font-extrabold">Sorted into projects</figcaption>
            </figure>
            <Arrow />
            <figure>
              <div className="flex items-center justify-center py-2 lg:h-[400px] lg:py-0">
                <PlanVisual />
              </div>
              <figcaption className="mt-4 text-center font-extrabold">Planned into your days</figcaption>
            </figure>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1120px] px-4 pt-20 sm:px-6 sm:pt-28">
          <div className="mx-auto grid max-w-[980px] items-center gap-10 lg:grid-cols-[1fr_520px]">
            <div>
              <h2 className="text-[30px] font-black leading-tight tracking-tight sm:text-[36px]">Quotes, word for word</h2>
              <p className="mt-3 max-w-[420px] text-[18px] leading-relaxed text-muted">
                For books, some lines are worth knowing exactly. Say yes to a Quotes lesson and you fill in, reorder, then type them from memory.
              </p>
            </div>
            <QuotesDemo />
          </div>
        </section>

        <section id="ios" className="mx-auto w-full max-w-[1120px] scroll-mt-6 px-4 pt-20 sm:px-6 sm:pt-28">
          <div className="rounded-[32px] border-2 border-line px-5 py-10 sm:px-10 sm:py-12">
            <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto]">
              <div className="max-w-[520px]">
                <h2 className="text-[30px] font-black leading-tight tracking-tight sm:text-[36px]">Get the iPhone app</h2>
                <p className="mt-3 text-[18px] leading-relaxed text-muted">
                  The iPhone app lives in this project under <code className="rounded-[6px] bg-shelf px-1.5 py-0.5 text-[16px] font-bold text-ink">ios/</code>. It is not on the App Store yet.
                </p>
                <ul className="mt-5 grid grid-cols-1 gap-3 text-[17px]">
                  <li className="flex gap-3">
                    <span className="mt-2 h-2 w-2 flex-none rounded-full bg-blue" />
                    <span>
                      Open the Xcode project in <code className="font-bold">ios/</code>, pick your iPhone, and press Run.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-2 w-2 flex-none rounded-full bg-blue" />
                    <span>It scans your Screenshots album, photos of notes and whiteboards, and reads them on device.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-2 w-2 flex-none rounded-full bg-blue" />
                    <span>Move your library between web and iPhone with Export and Import in Settings.</span>
                  </li>
                </ul>
              </div>
              <div className="flex justify-center gap-4">
                <IPhoneFrame src={pathShot} alt="Lesson path on iPhone" width={210} />
                <div className="hidden sm:block">
                  <IPhoneFrame src={lesson} alt="A lesson on iPhone" width={210} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1120px] px-4 py-24 text-center sm:px-6 sm:py-32">
          <h2 className="mx-auto max-w-[640px] text-[32px] font-black leading-tight tracking-tight sm:text-[40px]">Start with what you already saved.</h2>
          <p className="mt-3 text-muted">No account. Your library stays on this device.</p>
          <Link href="/app" className="btn mt-8 min-w-[220px]">
            Start studying
          </Link>
        </section>
      </main>

      <footer className="border-t-2 border-line">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col items-center justify-between gap-3 px-4 py-8 text-[14px] font-bold text-muted sm:flex-row sm:px-6">
          <Logo />
          <p>Made for the things you actually want to learn.</p>
        </div>
      </footer>
    </div>
  );
}
