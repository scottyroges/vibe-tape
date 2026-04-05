/**
 * Constants for the playlist detail page. Lives in a sibling module
 * because Next.js's `page.tsx` files can't export arbitrary names —
 * only the default component and a small allowlist (`metadata`,
 * `generateStaticParams`, etc.). Tests import from here so they don't
 * duplicate the values.
 */

/**
 * Poll interval while the playlist is GENERATING. 1s gives the user
 * near-instant feedback (realistic generation takes 3–6 seconds).
 */
export const POLL_INTERVAL_MS = 1000;

/**
 * Hard cap on client-side polling as a belt-and-suspenders guard
 * against a stuck GENERATING row whose server-side TTL override also
 * misfires. 120 * 1s = 2 minutes (20× realistic generation time).
 */
export const MAX_POLLS = 120;
