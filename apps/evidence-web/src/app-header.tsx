import React from "react";
import {
  OrganizationSwitcher,
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton
} from "@clerk/clerk-react";
import { Link } from "react-router";

import { clerkPublishableKey } from "./env";

export function AppHeader(): React.JSX.Element | null {
  if (!clerkPublishableKey) return null;
  return (
    <header className="app-header">
      <Link to="/" className="app-header-brand">
        Jittle Lamp
      </Link>
      <div className="app-header-right">
        <SignedIn>
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/"
            afterSelectOrganizationUrl="/"
            appearance={{ elements: { rootBox: "app-header-org" } }}
          />
          <Link to="/join" className="btn-ghost btn-sm">
            Join organisation
          </Link>
          <UserButton />
        </SignedIn>
        <SignedOut>
          <SignInButton mode="modal">
            <button className="btn-ghost btn-sm" type="button">
              Sign in
            </button>
          </SignInButton>
        </SignedOut>
      </div>
    </header>
  );
}
