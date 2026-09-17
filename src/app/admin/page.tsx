import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  redirect((await isAdminAuthenticated()) ? "/admin/productos" : "/admin/login");
}
