import { redirect } from "next/navigation";
import { redirectAuthenticatedAuthPage } from "@/lib/auth/auth-page-redirect";

export default async function HomePage() {
  await redirectAuthenticatedAuthPage({});
  redirect("/login");
}
