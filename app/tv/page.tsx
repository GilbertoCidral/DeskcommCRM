import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { TvDashboard } from "@/app/app/tv/TvDashboard";

export const dynamic = "force-dynamic";

export default async function TvPublicPage() {
  const cookieStore = await cookies();
  const tvToken = cookieStore.get("tv_token")?.value;

  if (!tvToken) redirect("/tv/par");

  const admin = createAdminClient();
  const { data } = await admin
    .from("tv_pairing_codes")
    .select("id")
    .eq("access_token", tvToken)
    .eq("status", "confirmed")
    .gt("token_expires_at", new Date().toISOString())
    .maybeSingle();

  if (!data) redirect("/tv/par");

  return <TvDashboard />;
}
