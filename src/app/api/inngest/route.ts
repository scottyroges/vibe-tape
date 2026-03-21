import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { syncLibrary } from "@/inngest/functions/sync-library";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncLibrary],
});
