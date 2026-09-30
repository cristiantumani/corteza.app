// Types for `npm run typecheck` only (no runtime code): what we keep in the session.
import 'express-session';

declare global {
  namespace Corteza {
    /** The signed-in person (src/auth/google-signin.js, or the demo in src/routes/demo.js) */
    interface SessionUser {
      user_id: string;
      user_name: string;
      workspace_id: string;
      workspace_name?: string;
      email?: string;
      picture?: string | null;
      auth_provider?: string;
      authenticated_at?: string;
      is_demo?: boolean;
      [key: string]: unknown;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    user: Corteza.SessionUser;
    isDemo: boolean;
    /** Google sign-in in progress (src/auth/routes.js) */
    oauth: { state: string; nonce: string; started_at: number; inviteId?: string | null; returnTo?: string | null };
    /** "Connect Google Meet" in progress (src/integrations/google/routes.js) */
    googleConnect: { state: string; nonce: string; started_at: number };
  }
}
