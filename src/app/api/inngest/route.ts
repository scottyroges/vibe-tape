import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { syncLibrary } from "@/inngest/functions/sync-library";
import { enrichLastfm } from "@/inngest/functions/enrich-lastfm";
import { generatePlaylist } from "@/inngest/functions/generate-playlist";
import { regeneratePlaylist } from "@/inngest/functions/regenerate-playlist";
import { topUpPlaylist } from "@/inngest/functions/top-up-playlist";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncLibrary,
    enrichLastfm,
    generatePlaylist,
    regeneratePlaylist,
    topUpPlaylist,
  ],
});
