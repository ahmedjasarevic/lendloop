import { Show } from "@clerk/nextjs";
import { ConvexHttpClient } from "convex/browser";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { Badge, Button } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/categories";
import type { PublicToolView } from "@/lib/types";

// The board is live data; never prerender it at build time.
export const dynamic = "force-dynamic";

async function loadTools(): Promise<PublicToolView[]> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return [];
  try {
    return await new ConvexHttpClient(url).query(api.tools.listPublic, {});
  } catch {
    // A landing page should never 500 because the backend is not reachable yet.
    return [];
  }
}

const STEPS = [
  {
    title: "List what you have",
    body: "A drill, a ladder, a tent. Two sentences and a category is enough.",
  },
  {
    title: "Ask for a date range",
    body: "Neighbors request specific days, so nobody has to negotiate by text.",
  },
  {
    title: "Let the loop remind you",
    body: "Request updates and overdue returns are handled by automated n8n workflows.",
  },
];

export default async function HomePage() {
  const tools = await loadTools();

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main>
        <section className="mx-auto w-full max-w-5xl px-4 pt-16 pb-14 sm:pt-24">
          <Badge tone="green">Neighborhood tool library</Badge>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
            Borrow what you need. Lend what you don&apos;t.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-stone-600">
            LendLoop is a small board for a street, a building or a climbing club. Post the tools
            you are happy to share, ask for the ones you are missing, and let the reminders take
            care of the awkward part.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Show when="signed-out">
              <Link href="/sign-in">
                <Button>Sign in to lend or borrow</Button>
              </Link>
              <Link href="/sign-up">
                <Button variant="secondary">Create an account</Button>
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/browse">
                <Button>Open the board</Button>
              </Link>
            </Show>
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Sign in with Clerk. No passwords stored by LendLoop.
          </p>
        </section>

        <section className="border-y border-stone-200 bg-white">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-12 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title}>
                <span className="text-xs font-semibold text-stone-400">0{index + 1}</span>
                <h2 className="mt-1 text-sm font-semibold text-stone-900">{step.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 py-14">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-stone-900">On the board</h2>
            <span className="text-xs text-stone-500">
              {tools.length === 0
                ? "Nothing listed yet"
                : `${tools.length} ${tools.length === 1 ? "tool" : "tools"} available`}
            </span>
          </div>

          {tools.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
              <p className="text-sm font-medium text-stone-800">The board is empty</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
                Be the first neighbor to list something. Sign in, add a tool, and it will appear
                here — without your name attached, until someone asks for it.
              </p>
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => (
                <li
                  key={tool._id}
                  className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm"
                >
                  <p className="truncate text-sm font-medium text-stone-900">{tool.name}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{categoryLabel(tool.category)}</p>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-stone-500">
            The public board shows tool names and categories only. Owner details unlock after sign
            in, and only for tools you can actually borrow.
          </p>
        </section>
      </main>

      <footer className="border-t border-stone-200 py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-stone-500">
          <span>LendLoop — a demo build for a take-home assignment.</span>
          <span>Next.js · Clerk · Convex · n8n</span>
        </div>
      </footer>
    </div>
  );
}
