import { redirect } from "next/navigation";

type WorkspaceRootPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

export default async function WorkspaceRootPage({ params }: WorkspaceRootPageProps) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/my-work`);
}
