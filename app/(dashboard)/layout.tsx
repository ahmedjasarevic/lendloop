import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { DashboardNav } from "@/components/DashboardNav";
import { UserSync } from "@/components/UserSync";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen">
      <UserSync />
      <DashboardNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
