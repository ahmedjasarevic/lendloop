import { Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { Button } from "./ui";

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-stone-900 text-[11px] font-bold tracking-tight text-white">
        LL
      </span>
      <span className="text-base font-semibold tracking-tight text-stone-900">LendLoop</span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" aria-label="LendLoop home">
          <Logo />
        </Link>

        <div className="flex items-center gap-2">
          <Show when="signed-out">
            <Link href="/sign-in">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button size="sm">Join the loop</Button>
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/browse">
              <Button size="sm">Open board</Button>
            </Link>
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
