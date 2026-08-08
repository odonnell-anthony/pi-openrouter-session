/**
 * OpenRouter Session ID Extension
 *
 * Automatically includes a session_id in OpenRouter API requests so you can
 * track conversations in the OpenRouter console/dashboard.
 *
 * The session_id is derived from pi's session name (set via `/name <name>`) combined
 * with a short unique identifier from the session file, giving you human-readable
 * grouping in the OpenRouter console. If no name is set, falls back to the raw
 * session file identifier. Ephemeral sessions (--no-session) get a random ID.
 *
 * The session_id is resolved on every request so that renaming a session mid-way
 * through (via `/name`) is immediately reflected in subsequent OpenRouter requests.
 *
 * Examples:
 *   /name Refactor auth module  →  session_id: "refactor-auth-module-019dbbc7"
 *   (no name set)               →  session_id: "2026-05-06T12-00-00-000Z_019dbbc7-..."
 *   --no-session                →  session_id: "ephemeral-1234567890-abc123"
 *
 * Installation:
 *   - Place this file in ~/.pi/agent/extensions/
 *   - Run /reload in pi to load the extension
 *   - Or restart pi
 *
 * Usage:
 *   - Use OpenRouter as your provider (--provider openrouter or /model)
 *   - The extension automatically adds session_id to requests
 *   - View your sessions in the OpenRouter console
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Stable unique base derived from the session file name for this session lifetime.
  // Combined with the human-readable name (if set) to build the final session_id.
  let baseSessionId: string | null = null;
  let lastLoggedSessionId: string | null = null;

  /**
   * Converts a human-readable session name into a URL/ID-safe slug.
   * e.g. "Refactor auth module!" -> "refactor-auth-module"
   */
  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric runs -> single hyphen
      .replace(/^-+|-+$/g, "")     // strip leading/trailing hyphens
      .slice(0, 50);               // cap length to keep IDs readable
  }

  /**
   * Builds the session_id to send to OpenRouter.
   * If the user has named the session, produces "<slug>-<short-base-id>" for
   * human-readable grouping whilst remaining unique across same-named sessions.
   * Otherwise returns the raw base ID.
   */
  function buildSessionId(): string | null {
    if (!baseSessionId) return null;

    const name = pi.getSessionName();
    if (name) {
      const slug = slugify(name);
      // Session filenames are "<ISO-timestamp>_<uuid>" - extract the UUID portion
      // for the short ID so we don't bleed timestamp digits/hyphens into the slug.
      // e.g. "2026-05-06T12-00-00-000Z_019dbbc7-c8c5-748c-8710-3fdf6fefc083"
      //   -> shortId = "019dbbc7"
      const uuidPart = baseSessionId.split("_")[1] ?? baseSessionId;
      const shortId = uuidPart.replace(/-/g, "").slice(0, 8);
      return `${slug}-${shortId}`;
    }

    return baseSessionId;
  }

  // Establish the base session ID whenever the session starts, changes, or reloads
  pi.on("session_start", async (_event, ctx) => {
    baseSessionId = null;
    lastLoggedSessionId = null;
    const sessionFile = ctx.sessionManager.getSessionFile();

    if (sessionFile) {
      // Extract the filename without extension as the stable base ID
      // e.g. "~/.pi/agent/sessions/--home--/2026-05-06T12-00-00-000Z_019dbbc7-c8c5-748c-8710-3fdf6fefc083.jsonl"
      //   -> "2026-05-06T12-00-00-000Z_019dbbc7-c8c5-748c-8710-3fdf6fefc083"
      // Windows paths use backslashes, so exclude both separators
      // e.g. "C:\\Users\\me\\.pi\\agent\\sessions\\2026-05-06T12-00-00-000Z_019dbbc7-c8c5-748c-8710-3fdf6fefc083.jsonl"
      const match = sessionFile.match(/([^/\\]+)\.jsonl$/);
      baseSessionId = match ? match[1] : null;
    }

    if (!baseSessionId) {
      // Ephemeral session (--no-session) - generate a random one-off ID
      baseSessionId = `ephemeral-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }

    console.log(`[openrouter-session] Ready, base session ID: ${baseSessionId}`);

    if (ctx.sessionManager.getEntries().length === 0) {
      ctx.ui?.notify("OpenRouter session tracking enabled", "info");
    }
  });

  // Intercept every provider request to inject session_id for OpenRouter calls
  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload as Record<string, unknown>;

    // Detect whether this is an OpenRouter request
    let isOpenRouter = false;

    // Method 1: model string contains provider prefix (e.g. "openrouter/anthropic/claude-3.5-sonnet")
    const model = payload.model as string | undefined;
    if (model?.includes("openrouter/")) {
      isOpenRouter = true;
    }

    // Method 2: current model's provider field
    if (!isOpenRouter && ctx.model?.provider === "openrouter") {
      isOpenRouter = true;
    }

    if (isOpenRouter) {
      // Resolve on every request - picks up any mid-session `/name` changes
      const sessionId = buildSessionId();
      if (sessionId) {
        // Only log when the ID changes to avoid spamming the console
        if (sessionId !== lastLoggedSessionId) {
          console.log(`[openrouter-session] Using session_id: ${sessionId}`);
          lastLoggedSessionId = sessionId;
        }

        return {
          ...payload,
          session_id: sessionId,
        };
      }
    }
  });
}
