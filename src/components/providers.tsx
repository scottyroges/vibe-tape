"use client";

import { TRPCReactProvider } from "@/lib/trpc/client";

export function Providers({ children }: { children: React.ReactNode }) {
  return <TRPCReactProvider>{children}</TRPCReactProvider>;
}
