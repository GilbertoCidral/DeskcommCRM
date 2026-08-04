import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { TvDashboard } from "@/app/app/tv/TvDashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTvData } from "@/lib/tv/data";

export const dynamic = "force-dynamic";

export default async function TvPublicPage() {
  const cookieStore = await cookies();
  const tvToken = cookieStore.get("tv_token")?.value;

  if (!tvToken) redirect("/tv/par");

  const admin = createAdminClient();
  const { data: pairRow } = await admin
    .from("tv_pairing_codes")
    .select("organization_id")
    .eq("access_token", tvToken)
    .eq("status", "confirmed")
    .gt("token_expires_at", new Date().toISOString())
    .maybeSingle();

  if (!pairRow?.organization_id) redirect("/tv/par");

  const orgId = pairRow.organization_id as string;
  const initialData = await fetchTvData(orgId, 6);

  if (!initialData) redirect("/tv/par");

  return <TvDashboard initialData={initialData} />;
}
