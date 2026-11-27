import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-sm font-semibold tracking-tight text-stone-900">
        LendLoop
      </Link>
      <SignUp fallbackRedirectUrl="/browse" />
      <p className="text-xs text-stone-500">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-stone-800 underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
