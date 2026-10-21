import type { Metadata } from "next";
import { Contact, LegalPage } from "@/components/landing/Legal";

export const metadata: Metadata = { title: "Privacy Policy · OpenStudy" };
export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 20, 2026">
      <p>OpenStudy is built so your study material stays with you. This page says exactly what leaves your device and why.</p>

      <h2>Stays on your device</h2>
      <ul>
        <li>Your library: projects, pages, lessons, cards, progress and streaks. On iPhone it is stored in the app; on the web, in your browser.</li>
        <li>Your screenshots and photos. Text is read from them on the device.</li>
        <li>The Apple Notes and Photos you choose to bring in. OpenStudy only reads them when you ask it to.</li>
      </ul>

      <h2>Sent to our server</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address and a password (stored only as a secure hash), used to sign you in and to connect your subscription across the iPhone app and the
          website. We send a welcome email when you make an account, and a reset link if you ask for one.
        </li>
        <li>
          <strong>Usage data, unless you turn it off in Settings:</strong> what kinds of things you do in the app, as categories and counts. For example: you imported 5 pages from 2 PDFs and 3
          photos, sorted them into a Biology class and a book under Reading, and finished a 4 minute lesson. It is tied to a random ID made by the app, and to your account when you are signed
          in. It never includes the text of your notes, titles, file names, images or answers. We use it to see what people study and what to improve.
        </li>
        <li>
          <strong>Your subscription status:</strong> whether you are subscribed or in a trial and when it renews. App Store purchases are confirmed with Apple; web payments are processed by
          Stripe. We never see your card details.
        </li>
        <li>
          <strong>Smart organize and Ask, only when you use them:</strong> the text of the pages involved (and, for reading handwriting, the image) is sent to our server and to Anthropic to sort,
          build lessons or answer your question. It is used only to produce that result.
        </li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your data or use it for advertising.</li>
        <li>We do not track you across other apps or websites.</li>
        <li>We do not upload your library to sync it. Export and import files are yours to move.</li>
      </ul>

      <h2>Services we use</h2>
      <ul>
        <li>Supabase, for accounts and subscription status.</li>
        <li>Stripe, for web payments. Apple, for App Store payments.</li>
        <li>Anthropic, for smart organize and Ask.</li>
        <li>Vercel, which hosts the website and server.</li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        Delete your account from your profile to remove your email and subscription record from our server; usage data is then no longer linked to you. To remove your library, use Settings, then Reset everything, or delete the app. Contact us
        for anything else.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions: <Contact />.
      </p>
    </LegalPage>
  );
}
