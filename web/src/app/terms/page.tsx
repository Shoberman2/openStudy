import type { Metadata } from "next";
import { Contact, LegalPage } from "@/components/landing/Legal";

export const metadata: Metadata = { title: "Terms of Use · OpenStudy" };
export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="October 20, 2026">
      <p>These terms cover the OpenStudy iPhone app and the OpenStudy website. By using either, you agree to them.</p>

      <h2>OpenStudy Plus</h2>
      <ul>
        <li>OpenStudy Plus is a monthly subscription: $10 a month (or the local equivalent shown at checkout), after a 7-day free trial for new subscribers.</li>
        <li>It renews automatically each month until you cancel. On iPhone, payment is charged to your Apple ID and you manage or cancel it in your Apple ID settings at least 24 hours before the period ends. On the web, payment is handled by Stripe and you cancel from your profile.</li>
        <li>If you cancel during the free trial, you are not charged. If you cancel later, Plus stays on until the end of the period you paid for.</li>
        <li>One subscription covers your account on both the iPhone app and the website.</li>
        <li>Refunds for App Store purchases are handled by Apple. For web purchases, contact us.</li>
      </ul>

      <h2>Your material</h2>
      <p>
        You keep all rights to the notes, screenshots, photos and files you bring into OpenStudy. Only bring in material you are allowed to use for your own study. Your library is stored on your
        device; see the Privacy Policy for what leaves it.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not use OpenStudy to break the law, to infringe anyone&apos;s rights, or to attack or overload the service.</p>

      <h2>The service</h2>
      <p>
        We work to keep OpenStudy accurate and available, but lessons, summaries and answers are generated from your own material and can contain mistakes. OpenStudy is provided as is, without
        warranties, to the extent the law allows. We may change or end features; if we end OpenStudy Plus, we will stop charging you.
      </p>

      <h2>Your account</h2>
      <p>You can delete your account at any time from your profile. Deleting it cancels a web subscription; an App Store subscription must also be canceled in your Apple ID settings.</p>

      <h2>Apple</h2>
      <p>
        For the iPhone app, Apple&apos;s{" "}
        <a className="underline" href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">
          Standard End User License Agreement
        </a>{" "}
        also applies.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <Contact />.
      </p>
    </LegalPage>
  );
}
