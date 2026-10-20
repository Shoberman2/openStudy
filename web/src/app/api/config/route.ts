// Public client configuration for accounts and billing (spec 11.4). The publishable key is safe to
// share; it only allows what row level security allows.
import { PLUS_PRODUCT_ID } from "@/engine/billing";
import { billingEnabled, publishableKey } from "@/lib/server/billing";
import { stripeEnabled } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

export function GET() {
  if (!billingEnabled()) return Response.json({ billing: false });
  return Response.json({
    billing: true,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    supabaseKey: publishableKey(),
    appleProductId: PLUS_PRODUCT_ID,
    stripe: stripeEnabled(),
  });
}
