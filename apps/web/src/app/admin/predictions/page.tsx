import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { PredictionOperations } from "@/components/admin/prediction-operations";
import { getAdminAccess } from "@/lib/admin";
import { getAdminPredictionOperationsModel } from "@/lib/admin-predictions";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPredictionsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/predictions");
  if (!access.isSuper) redirect("/admin");
  const locale = await getRequestLocale();
  const model = await getAdminPredictionOperationsModel();
  const arabic = locale === "ar";
  return <AdminPageShell maxWidth="6xl" breadcrumbs={[{ label: arabic ? "لوحة الإدارة" : "Admin" , href: "/admin" }, { label: arabic ? "عمليات التوقعات" : "Prediction operations" }]} eyebrow={arabic ? "مدير علوي فقط" : "Super admin only"} title={arabic ? "عمليات التوقعات" : "Prediction operations"} description={arabic ? "شخّص الجولات وضع الإجراءات الآمنة في طابور البوت." : "Diagnose rounds and queue safe actions for the bot process."}><PredictionOperations model={model} locale={locale} /></AdminPageShell>;
}
