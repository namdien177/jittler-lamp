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
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import { z } from "zod/v4";

import { AppHeader } from "./app-header";
import { api } from "./api";
import { clerkPublishableKey } from "./env";
import { useAcceptInvitation } from "./queries";

const joinOrganizationFormSchema = z.object({
  token: z.string().trim().min(1, "Paste the invitation code."),
  password: z.string().optional()
});

type JoinOrganizationFormValues = z.infer<typeof joinOrganizationFormSchema>;

function safeRedirectPath(input: string | null): string {
  if (!input) return "/";
  if (!input.startsWith("/") || input.startsWith("//")) return "/";
  return input;
}

function JoinOrganizationForm(): React.JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const acceptMutation = useAcceptInvitation();
  const [searchParams] = useSearchParams();
  const redirectPath = safeRedirectPath(searchParams.get("redirect"));
  const form = useForm<JoinOrganizationFormValues>({
    resolver: zodResolver(joinOrganizationFormSchema),
    defaultValues: {
      token: searchParams.get("code") ?? "",
      password: ""
    }
  });
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = acceptMutation.isPending;

  const submit = async (values: JoinOrganizationFormValues): Promise<void> => {
    const trimmed = values.token.trim();
    if (!requiresPassword) {
      setCheckingCode(true);
      const lookedUp = await api.lookupInvitation(() => auth.getToken(), trimmed).catch(() => null);
      setCheckingCode(false);
      if (lookedUp?.code.requiresPassword) {
        setRequiresPassword(true);
        setError("This invitation code is password protected.");
        return;
      }
    }
    if (requiresPassword && !values.password) {
      setError("Enter the invitation password.");
      return;
    }
    setError(null);
    acceptMutation.mutate({ token: trimmed, ...(requiresPassword && values.password ? { password: values.password } : {}) }, {
      onSuccess: () => navigate(redirectPath, { replace: true }),
      onError: (err) =>
        setError(err instanceof Error ? err.message : "Unable to accept invitation.")
    });
  };

  return (
    <div className="app-shell">
      <AppHeader />
      <main className="desktop-auth-page">
        <section className="desktop-auth-panel" aria-live="polite">
          <h1>Join an organisation</h1>
          <p>Paste the invitation code an organisation owner shared with you.</p>
          <form
            className="join-form"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit(submit)(event);
            }}
          >
            <input
              className="join-input"
              type="text"
              placeholder="inv_…"
              autoFocus
              disabled={busy}
              {...form.register("token")}
            />
            {form.formState.errors.token ? <p className="join-error">{form.formState.errors.token.message}</p> : null}
            {requiresPassword ? (
              <input
                className="join-input"
                type="password"
                placeholder="Invitation password"
                disabled={busy}
                {...form.register("password")}
              />
            ) : null}
            {error ? <p className="join-error">{error}</p> : null}
            <div className="join-actions">
              <button className="drop-btn" type="submit" disabled={busy}>
                {busy ? "Joining…" : checkingCode ? "Checking…" : "Join workspace"}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
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
