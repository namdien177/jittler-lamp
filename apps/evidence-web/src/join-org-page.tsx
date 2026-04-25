import React, { useState } from "react";
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
import { useNavigate, useSearchParams } from "react-router";

import { api } from "./api";
import { clerkPublishableKey } from "./env";

function safeRedirectPath(input: string | null): string {
  if (!input) return "/";
  if (!input.startsWith("/") || input.startsWith("//")) return "/";
  return input;
}

function JoinOrganizationForm(): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectPath = safeRedirectPath(searchParams.get("redirect"));
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Paste the invitation code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvitation(auth.getToken, trimmed);
      navigate(redirectPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="desktop-auth-page">
      <section className="desktop-auth-panel" aria-live="polite">
        <h1>Join an organisation</h1>
        <p>Paste the invitation code an organisation owner shared with you.</p>
        <form
          className="join-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            className="join-input"
            type="text"
            placeholder="inv_…"
            value={token}
            autoFocus
            disabled={busy}
            onChange={(event) => setToken(event.currentTarget.value)}
          />
          {error ? <p className="join-error">{error}</p> : null}
          <div className="join-actions">
            <button className="drop-btn" type="submit" disabled={busy}>
              {busy ? "Joining…" : "Join workspace"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export function JoinOrganizationPage(): React.JSX.Element {
  const currentUrl = window.location.href;

  if (!clerkPublishableKey) {
    return (
      <main className="desktop-auth-page">
        <section className="desktop-auth-panel">
          <h1>Clerk is not configured</h1>
          <p>Set CLERK_PUBLISHABLE_KEY before joining an organisation.</p>
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
        <SignedIn>
          <JoinOrganizationForm />
        </SignedIn>
      </ClerkLoaded>
    </>
  );
}
