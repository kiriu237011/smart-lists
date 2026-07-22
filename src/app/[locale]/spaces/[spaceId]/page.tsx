import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ensureSpaceState, getUserSpace } from "@/lib/spaces";
import AuthenticatedHome from "@/components/spaces/AuthenticatedHome";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ locale: string; spaceId: string }>;
}) {
  const [{ locale, spaceId }, session] = await Promise.all([params, auth()]);
  if (!session?.user?.id) redirect(`/${locale}`);

  const defaultId = await ensureSpaceState(session.user.id);
  const space = await getUserSpace(session.user.id, spaceId);
  if (!space) redirect(`/${locale}/spaces/${defaultId}`);

  return (
    <AuthenticatedHome
      userId={session.user.id}
      userName={session.user.name ?? null}
      userEmail={session.user.email ?? ""}
      spaceId={space.id}
    />
  );
}
