import { OnboardingForm } from "@/components/auth/onboarding-form";

type OnboardingPageProps = Readonly<{
  searchParams: Promise<{
    provider?: string | string[];
    redirect?: string | string[];
  }>;
}>;

function normalizeQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const resolvedSearchParams = await searchParams;
  const provider = normalizeQueryValue(resolvedSearchParams.provider);
  const redirectPath = normalizeQueryValue(resolvedSearchParams.redirect);

  return <OnboardingForm provider={provider} redirectPath={redirectPath} />;
}
