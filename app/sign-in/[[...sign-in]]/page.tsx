import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-sm font-semibold tracking-tight text-stone-900">
        LendLoop
      </Link>
      <SignIn fallbackRedirectUrl="/browse" />
      <p className="text-xs text-stone-500">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-stone-800 underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
