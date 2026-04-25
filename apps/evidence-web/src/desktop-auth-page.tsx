import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ClerkDegraded,
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  SignIn,
  SignedIn,
  SignedOut,
  useAuth
} from "@clerk/clerk-react";

import { apiOrigin, clerkPublishableKey } from "./env";

type ApprovalState =
  | { status: "idle" | "submitting" }
  | { status: "approved" }
  | { status: "error"; message: string };

const readUserCode = () => new URL(window.location.href).searchParams.get("user_code")?.trim() ?? "";

function DesktopAuthApprovalInner(): React.JSX.Element {
  const { getToken } = useAuth();
  const submittedRef = useRef(false);
  const userCode = useMemo(() => readUserCode(), []);
  const [approval, setApproval] = useState<ApprovalState>(
    userCode ? { status: "idle" } : { status: "error", message: "Missing desktop sign-in code." }
  );

  useEffect(() => {
    if (!userCode || submittedRef.current) return;
    submittedRef.current = true;

    const approve = async (): Promise<void> => {
      setApproval({ status: "submitting" });
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Your browser session is missing a Clerk token.");
        }

        const response = await fetch(`${apiOrigin}/desktop-auth/flows/complete`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ userCode })
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(payload?.error?.message ?? "Unable to approve the desktop sign-in request.");
        }

        setApproval({ status: "approved" });
      } catch (error) {
        submittedRef.current = false;
        setApproval({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to approve the desktop sign-in request."
        });
      }
    };

    void approve();
  }, [getToken, userCode]);

  if (approval.status === "approved") {
    return (
      <main className="desktop-auth-page">
        <section className="desktop-auth-panel" aria-live="polite">
          <h1>Desktop sign-in approved</h1>
          <p>You can return to Jittle Lamp.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="desktop-auth-page">
      <section className="desktop-auth-panel" aria-live="polite">
        <h1>Connect Jittle Lamp</h1>
        <p>
          {approval.status === "submitting"
            ? "Approving your desktop sign-in..."
            : approval.status === "error"
              ? approval.message
              : "Waiting for browser sign-in..."}
        </p>
      </section>
    </main>
  );
}

export function DesktopAuthApprovalPage(): React.JSX.Element {
  const currentUrl = window.location.href;

  if (!clerkPublishableKey) {
    return (
      <main className="desktop-auth-page">
        <section className="desktop-auth-panel">
          <h1>Clerk is not configured</h1>
          <p>Set CLERK_PUBLISHABLE_KEY before using browser sign-in.</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <ClerkFailed>
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel">
            <h1>Unable to load sign-in</h1>
            <p>Check the Clerk publishable key and network access.</p>
          </section>
        </main>
      </ClerkFailed>
      <ClerkDegraded>
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel">
            <h1>Unable to load sign-in</h1>
            <p>Check the Clerk publishable key and network access.</p>
          </section>
        </main>
      </ClerkDegraded>
      <ClerkLoading>
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel">
            <h1>Loading sign-in</h1>
          </section>
        </main>
      </ClerkLoading>
      <ClerkLoaded>
        <SignedIn>
          <DesktopAuthApprovalInner />
        </SignedIn>
        <SignedOut>
          <main className="desktop-auth-page">
            <SignIn
              routing="hash"
              forceRedirectUrl={currentUrl}
              fallbackRedirectUrl={currentUrl}
              signUpForceRedirectUrl={currentUrl}
              signUpFallbackRedirectUrl={currentUrl}
            />
          </main>
        </SignedOut>
      </ClerkLoaded>
    </>
  );
}
