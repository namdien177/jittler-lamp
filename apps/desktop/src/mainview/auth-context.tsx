import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ClerkProvider, useAuth, useClerk, useSignIn, useUser } from "@clerk/clerk-react";
import { useNavigate } from "react-router";

import { api, apiOrigin, type ApiAccountProfile, type FetchToken } from "./api";
import { createDesktopBridge } from "./desktop-bridge";

type DesktopAuthSignedInState = {
  status: "signed-in";
  source: "clerk" | "desktop";
  userId: string;
  label: string;
  accessToken?: string;
  profile?: ApiAccountProfile;
  expiresAt?: number;
};

export type DesktopAuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | DesktopAuthSignedInState;

export type BrowserAuthFlowState =
  | { status: "idle" }
  | { status: "starting" }
  | {
      status: "polling";
      userCode: string;
      verificationUriComplete: string;
      expiresAt: number;
      intervalSeconds: number;
    }
  | { status: "error"; message: string };

export type PasswordSignInResult = { ok: true } | { ok: false; message: string };

export type DesktopAuthController = {
  state: DesktopAuthState;
  browserFlow: BrowserAuthFlowState;
  signInWithPassword: (input: { identifier: string; password: string }) => Promise<PasswordSignInResult>;
  startBrowserSignIn: () => Promise<void>;
  clearBrowserFlow: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  getToken: FetchToken;
};

type StoredDesktopAuthSession = {
  accessToken: string;
  expiresAt: number;
  clerkUserId: string;
};

const desktopAuthStorageKey = "jittle-lamp.desktop-auth.v1";
const signInPath = "/sign-in";

const DesktopAuthContext = createContext<DesktopAuthController | null>(null);

export const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";

function readStored(): StoredDesktopAuthSession | null {
  const raw = window.localStorage.getItem(desktopAuthStorageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDesktopAuthSession>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.clerkUserId !== "string"
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      clerkUserId: parsed.clerkUserId
    };
  } catch {
    return null;
  }
}

function writeStored(session: StoredDesktopAuthSession): void {
  window.localStorage.setItem(desktopAuthStorageKey, JSON.stringify(session));
}

function clearStored(): void {
  window.localStorage.removeItem(desktopAuthStorageKey);
}

function isFresh(session: StoredDesktopAuthSession): boolean {
  return session.expiresAt > Date.now() + 60_000;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? fallback;
}

export function getAccountDisplayLabel(profile: ApiAccountProfile, fallback: string): string {
  const displayName = profile.user.displayName.trim();
  if (displayName && displayName !== profile.user.id) return displayName;
  return profile.user.email ?? displayName ?? fallback;
}

type ClerkNavigationMetadata = {
  windowNavigate: (to: URL | string) => void;
};

function shouldUseWindowNavigation(to: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith("//");
}

export function DesktopClerkProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const navigate = useNavigate();

  const createRouter = (replace: boolean) => (to: string, metadata?: ClerkNavigationMetadata) => {
    if (shouldUseWindowNavigation(to)) {
      if (metadata) metadata.windowNavigate(to);
      else window.location.href = to;
      return;
    }
    navigate(to, { replace });
  };

  const routerPush = useMemo(() => createRouter(false), [navigate]);
  const routerReplace = useMemo(() => createRouter(true), [navigate]);

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      signInUrl={signInPath}
      afterSignOutUrl={signInPath}
      routerPush={routerPush}
      routerReplace={routerReplace}
    >
      {props.children}
    </ClerkProvider>
  );
}

export function DesktopAuthProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const clerkAuth = useAuth();
  const clerk = useClerk();
  const signIn = useSignIn();
  const { user } = useUser();
  const bridge = useMemo(() => createDesktopBridge(), []);
  const pollTimerRef = useRef<number | null>(null);
  const [state, setState] = useState<DesktopAuthState>({ status: "loading" });
  const [browserFlow, setBrowserFlow] = useState<BrowserAuthFlowState>({ status: "idle" });

  const stopPolling = (): void => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const getToken: FetchToken = async () => {
    if (state.status !== "signed-in") return null;
    if (state.source === "desktop") {
      return state.accessToken ?? readStored()?.accessToken ?? null;
    }
    return await clerkAuth.getToken({ skipCache: true });
  };

  const refreshProfile = async (): Promise<void> => {
    if (state.status !== "signed-in") return;
    try {
      const profile = await api.fetchAccountProfile(getToken);
      setState((prev) =>
        prev.status === "signed-in"
          ? { ...prev, profile, label: getAccountDisplayLabel(profile, prev.label) }
          : prev
      );
    } catch {
      // ignored
    }
  };

  const loadStored = async (): Promise<void> => {
    const stored = readStored();
    if (!stored || !isFresh(stored)) {
      clearStored();
      setState({ status: "signed-out" });
      return;
    }
    try {
      const profile = await api.fetchAccountProfile(async () => stored.accessToken);
      setState({
        status: "signed-in",
        source: "desktop",
        userId: profile.userId || stored.clerkUserId,
        label: getAccountDisplayLabel(profile, stored.clerkUserId),
        accessToken: stored.accessToken,
        profile,
        expiresAt: stored.expiresAt
      });
    } catch (error) {
      clearStored();
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Stored desktop session is no longer valid."
      });
    }
  };

  useEffect(() => {
    if (!clerkAuth.isLoaded) {
      setState({ status: "loading" });
      return;
    }
    if (clerkAuth.isSignedIn) {
      clearStored();
      setState({
        status: "signed-in",
        source: "clerk",
        userId: clerkAuth.userId ?? user?.id ?? "current-user",
        label:
          user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? clerkAuth.userId ?? "Signed in"
      });
      return;
    }
    void loadStored();
  }, [
    clerkAuth.isLoaded,
    clerkAuth.isSignedIn,
    clerkAuth.userId,
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
    user?.fullName,
    user?.username
  ]);

  useEffect(() => {
    if (state.status !== "signed-in") return;
    if (state.profile) return;
    void refreshProfile();
  }, [state.status, state.status === "signed-in" ? state.userId : null]);

  useEffect(() => () => stopPolling(), []);

  const completeBrowserPoll = (input: { deviceCode: string; intervalSeconds: number }): void => {
    stopPolling();
    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiOrigin}/desktop-auth/flows/${encodeURIComponent(input.deviceCode)}`);
        if (!response.ok) {
          throw new Error(await readApiError(response, "Unable to check browser sign-in status."));
        }
        const payload = (await response.json()) as
          | { status: "pending" | "expired" | "denied"; expiresAt: number; intervalSeconds: number }
          | {
              status: "approved";
              tokenType: "Bearer";
              accessToken: string;
              expiresAt: number;
              expiresInSeconds: number;
              clerkUserId: string;
            };

        if (payload.status === "approved") {
          const session = {
            accessToken: payload.accessToken,
            expiresAt: payload.expiresAt,
            clerkUserId: payload.clerkUserId
          };
          writeStored(session);
          const profile = await api.fetchAccountProfile(async () => payload.accessToken).catch(() => null);
          setState({
            status: "signed-in",
            source: "desktop",
            userId: payload.clerkUserId,
            label: profile ? getAccountDisplayLabel(profile, payload.clerkUserId) : payload.clerkUserId,
            accessToken: payload.accessToken,
            ...(profile ? { profile } : {}),
            expiresAt: payload.expiresAt
          });
          setBrowserFlow({ status: "idle" });
          return;
        }

        if (payload.status === "pending") {
          completeBrowserPoll({
            deviceCode: input.deviceCode,
            intervalSeconds: payload.intervalSeconds || input.intervalSeconds
          });
          return;
        }

        setBrowserFlow({
          status: "error",
          message:
            payload.status === "expired"
              ? "The browser sign-in request expired. Start a new sign-in."
              : "The browser sign-in request was denied."
        });
      } catch (error) {
        setBrowserFlow({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to check browser sign-in status."
        });
      }
    }, Math.max(input.intervalSeconds, 1) * 1000);
  };

  const startBrowserSignIn = async (): Promise<void> => {
    stopPolling();
    setBrowserFlow({ status: "starting" });

    try {
      const response = await fetch(`${apiOrigin}/desktop-auth/flows`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to start browser sign-in."));
      }
      const payload = (await response.json()) as {
        deviceCode: string;
        userCode: string;
        verificationUriComplete: string;
        expiresAt: number;
        intervalSeconds: number;
      };

      setBrowserFlow({
        status: "polling",
        userCode: payload.userCode,
        verificationUriComplete: payload.verificationUriComplete,
        expiresAt: payload.expiresAt,
        intervalSeconds: payload.intervalSeconds
      });

      if (bridge) {
        await bridge.rpc.request.openExternalUrl({ url: payload.verificationUriComplete });
      } else {
        window.open(payload.verificationUriComplete, "_blank", "noopener,noreferrer");
      }

      completeBrowserPoll({
        deviceCode: payload.deviceCode,
        intervalSeconds: payload.intervalSeconds
      });
    } catch (error) {
      setBrowserFlow({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to start browser sign-in."
      });
    }
  };

  const signInWithPassword = async (input: {
    identifier: string;
    password: string;
  }): Promise<PasswordSignInResult> => {
    if (!signIn.isLoaded) return { ok: false, message: "Sign-in is still loading." };
    try {
      const result = await signIn.signIn.create({
        strategy: "password",
        identifier: input.identifier,
        password: input.password
      });
      if (result.status === "complete" && result.createdSessionId) {
        await signIn.setActive({ session: result.createdSessionId });
        clearStored();
        return { ok: true };
      }
      const status = result.status as string | null;
      if (status === "needs_second_factor" || status === "needs_client_trust") {
        return {
          ok: false,
          message: "This account needs additional verification. Continue in the browser to finish sign-in."
        };
      }
      return { ok: false, message: "Unable to finish password sign-in for this account." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to sign in with that password." };
    }
  };

  const signOut = async (): Promise<void> => {
    stopPolling();
    clearStored();
    setBrowserFlow({ status: "idle" });
    if (state.status === "signed-in" && state.source === "clerk") {
      await clerk.signOut();
    }
    setState({ status: "signed-out" });
  };

  const clearBrowserFlow = (): void => {
    stopPolling();
    setBrowserFlow({ status: "idle" });
  };

  const value = useMemo<DesktopAuthController>(
    () => ({
      state,
      browserFlow,
      signInWithPassword,
      startBrowserSignIn,
      clearBrowserFlow,
      signOut,
      refreshProfile,
      getToken
    }),
    [state, browserFlow, signIn.isLoaded]
  );

  return <DesktopAuthContext.Provider value={value}>{props.children}</DesktopAuthContext.Provider>;
}

export function useDesktopAuth(): DesktopAuthController {
  const ctx = useContext(DesktopAuthContext);
  if (!ctx) throw new Error("useDesktopAuth must be used within DesktopAuthProvider");
  return ctx;
}
