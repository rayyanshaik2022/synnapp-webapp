import { redirect } from "next/navigation";

type WorkspaceHomeRedirectPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

export default async function WorkspaceHomeRedirectPage({
  params,
}: WorkspaceHomeRedirectPageProps) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/my-work`);
}
