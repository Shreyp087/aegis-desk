import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth/session";

export default async function InboxScannerPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  redirect("/inbox");
}
