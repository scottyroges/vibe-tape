import "server-only";

import { createCallerFactory, createTRPCContext } from "@/server/trpc";
import { appRouter } from "@/server/routers/_app";

const createCaller = createCallerFactory(appRouter);

export async function serverTRPC() {
  const ctx = await createTRPCContext();
  return createCaller(ctx);
}
