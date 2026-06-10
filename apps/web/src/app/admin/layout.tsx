import { notFound, redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login");
  if (!access.allowed) notFound(); // don't advertise the admin area to non-staff
  return <>{children}</>;
}
