import { AuthForm } from "@/components/auth/auth-form";
import { redirectAuthenticatedAuthPage } from "@/lib/auth/auth-page-redirect";

type LoginPageProps = Readonly<{
  searchParams: Promise<{
    redirect?: string | string[];
  }>;
}>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  await redirectAuthenticatedAuthPage(resolvedSearchParams);

  return <AuthForm mode="login" />;
}
