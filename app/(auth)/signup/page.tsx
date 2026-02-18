import { AuthForm } from "@/components/auth/auth-form";
import { redirectAuthenticatedAuthPage } from "@/lib/auth/auth-page-redirect";

type SignupPageProps = Readonly<{
  searchParams: Promise<{
    redirect?: string | string[];
  }>;
}>;

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const resolvedSearchParams = await searchParams;
  await redirectAuthenticatedAuthPage(resolvedSearchParams);

  return <AuthForm mode="signup" />;
}
