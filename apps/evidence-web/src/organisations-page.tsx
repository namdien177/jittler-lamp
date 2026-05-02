import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import {
  api,
  type ApiCreatedInvitationCode,
  type ApiInvitationCode,
  type ApiMember,
  type ApiOrgSummary
} from "./api";

const createOrgSchema = z.object({
  name: z.string().trim().min(1, "Organisation name is required.").max(100)
});

const codeSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(80),
  role: z.enum(["moderator", "member"]),
  password: z.string().optional(),
  emailDomain: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, "").toLowerCase())
    .pipe(z.union([z.literal(""), z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Use a valid domain.")])),
  expiresDays: z.string().regex(/^\d*$/, "Use whole days only."),
  guestDays: z.string()
});

type CreateOrgValues = z.infer<typeof createOrgSchema>;
type CodeValues = z.infer<typeof codeSchema>;

function formatRelativeTime(value: number): string {
  const diff = Date.now() - value;
  const day = 24 * 60 * 60 * 1000;
  if (Math.abs(diff) < day) return diff >= 0 ? "today" : "today";
  const days = Math.round(Math.abs(diff) / day);
  return diff >= 0 ? `${days}d ago` : `in ${days}d`;
}

function memberName(member: ApiMember): string {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
  return fullName || member.displayName || member.email || "Unknown user";
}

export function OrganisationsPage(): React.JSX.Element {
  const auth = useAuth();
  const createForm = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: "" }
  });
  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: {
      label: "Team onboarding",
      role: "member",
      password: "",
      emailDomain: "",
      expiresDays: "",
      guestDays: ""
    }
  });
  const [orgs, setOrgs] = useState<ApiOrgSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [codes, setCodes] = useState<ApiInvitationCode[]>([]);
  const [createdCode, setCreatedCode] = useState<ApiCreatedInvitationCode | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const getToken = () => auth.getToken();
  const selectedOrg = orgs.find((org) => org.id === selectedOrgId) ?? null;
  const canManage = selectedOrg?.role === "owner" || selectedOrg?.role === "moderator";
  const isOwner = selectedOrg?.role === "owner";

  const loadOrgs = async (): Promise<void> => {
    const result = await api.listOrganizations(getToken);
    setOrgs(result.organizations);
    setSelectedOrgId((current) => current ?? result.organizations[0]?.id ?? null);
  };

  const loadDetails = async (orgId: string): Promise<void> => {
    const [memberResult, inviteResult] = await Promise.all([
      api.listMembers(getToken, orgId),
      api.listInvitations(getToken, orgId).catch(() => ({ invitations: [], codes: [] }))
    ]);
    setMembers(memberResult.members);
    setCodes(inviteResult.codes);
  };

  useEffect(() => {
    if (!auth.isLoaded || !auth.isSignedIn) return;
    void loadOrgs().catch((err) => setError(err instanceof Error ? err.message : "Unable to load organisations."));
  }, [auth.isLoaded, auth.isSignedIn]);

  useEffect(() => {
    if (!selectedOrgId) return;
    void loadDetails(selectedOrgId).catch((err) => setError(err instanceof Error ? err.message : "Unable to load organisation details."));
  }, [selectedOrgId]);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) =>
      [memberName(member), member.email ?? "", member.role].some((value) => value.toLowerCase().includes(query))
    );
  }, [members, search]);

  const createOrg = async (values: CreateOrgValues): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createOrganization(getToken, values.name);
      createForm.reset();
      await loadOrgs();
      setSelectedOrgId(result.organization.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create organisation.");
    } finally {
      setBusy(false);
    }
  };

  const createCode = async (values: CodeValues): Promise<void> => {
    if (!selectedOrg) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createInvitationCode(getToken, selectedOrg.id, {
        label: values.label,
        role: values.role,
        emailDomain: values.emailDomain || null,
        expiresAt: values.expiresDays ? Date.now() + Number(values.expiresDays) * 24 * 60 * 60 * 1000 : null,
        guestExpiresAfterDays: values.guestDays ? Number(values.guestDays) : null,
        ...(values.password?.trim() ? { password: values.password.trim() } : {})
      });
      setCreatedCode(result.code);
      codeForm.setValue("password", "");
      await loadDetails(selectedOrg.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create invitation code.");
    } finally {
      setBusy(false);
    }
  };

  const setRole = async (member: ApiMember, role: "moderator" | "member"): Promise<void> => {
    if (!selectedOrg) return;
    await api.updateMemberRole(getToken, selectedOrg.id, member.membershipId, role);
    await loadDetails(selectedOrg.id);
  };

  const removeMember = async (member: ApiMember): Promise<void> => {
    if (!selectedOrg) return;
    await api.removeMember(getToken, selectedOrg.id, member.membershipId);
    await loadDetails(selectedOrg.id);
    await loadOrgs();
  };

  const toggleCode = async (code: ApiInvitationCode): Promise<void> => {
    if (!selectedOrg) return;
    await api.setInvitationCodeLocked(getToken, selectedOrg.id, code.id, !code.lockedAt);
    await loadDetails(selectedOrg.id);
  };

  return (
    <div className="auth-shell">
      <main className="auth-main org-web-main">
        <header className="auth-main-header">
          <div>
            <h1 className="auth-page-title">Organisations</h1>
            <p className="auth-page-subtitle">Manage members, moderators, and reusable invitation codes.</p>
          </div>
          <form className="org-web-create" onSubmit={createForm.handleSubmit(createOrg)}>
            <input className="auth-search" placeholder="New organisation name" {...createForm.register("name")} />
            <button className="auth-button primary" type="submit" disabled={busy}>Create</button>
          </form>
        </header>

        <div className="auth-main-content org-web-grid">
          {error ? <div className="auth-error-banner">{error}</div> : null}
          <aside className="org-web-list">
            {orgs.map((org) => (
              <button key={org.id} className="org-web-list-item" data-active={org.id === selectedOrgId} type="button" onClick={() => setSelectedOrgId(org.id)}>
                <strong>{org.name}</strong>
                <span>{org.role} · {org.memberCount} members</span>
              </button>
            ))}
          </aside>

          <section className="org-web-detail">
            {selectedOrg ? (
              <>
                <div className="auth-toolbar">
                  <input className="auth-search" placeholder="Search members" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
                  <span className="auth-muted">{filteredMembers.length} members</span>
                </div>
                <table className="org-web-table">
                  <thead><tr><th>User</th><th>Role</th><th>Joined</th><th>Guest until</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredMembers.map((member) => {
                      const editable = canManage && member.role !== "owner" && (isOwner || member.role === "member");
                      return (
                        <tr key={member.membershipId}>
                          <td><strong>{memberName(member)}</strong><span>{member.email ?? "No email"}</span></td>
                          <td>{member.role}</td>
                          <td>{formatRelativeTime(member.joinedAt)}</td>
                          <td>{member.guestExpiresAt ? formatRelativeTime(member.guestExpiresAt) : "Permanent"}</td>
                          <td>
                            {editable && isOwner ? (
                              <select value={member.role === "moderator" ? "moderator" : "member"} onChange={(event) => void setRole(member, event.currentTarget.value as "moderator" | "member")}>
                                <option value="member">Member</option>
                                <option value="moderator">Moderator</option>
                              </select>
                            ) : null}
                            {editable ? <button className="auth-button ghost" type="button" onClick={() => void removeMember(member)}>Remove</button> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {canManage ? (
                  <form className="org-web-code-form" onSubmit={codeForm.handleSubmit(createCode)}>
                    <input className="auth-search" placeholder="Code label" {...codeForm.register("label")} />
                    <select {...codeForm.register("role")}><option value="member">Member</option><option value="moderator">Moderator</option></select>
                    <input className="auth-search" type="password" placeholder="Password optional" {...codeForm.register("password")} />
                    <input className="auth-search" placeholder="Email domain optional" {...codeForm.register("emailDomain")} />
                    <input className="auth-search" type="number" min="1" placeholder="Expires days" {...codeForm.register("expiresDays")} />
                    <select {...codeForm.register("guestDays")}><option value="">Permanent</option><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select>
                    <button className="auth-button primary" type="submit" disabled={busy || codes.length >= 3}>Create code</button>
                  </form>
                ) : null}
                {createdCode ? <div className="auth-error-banner">New code: {createdCode.code}</div> : null}
                <table className="org-web-table">
                  <thead><tr><th>Code</th><th>Restrictions</th><th>Guest</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {codes.map((code) => (
                      <tr key={code.id}>
                        <td><strong>{code.label}</strong><span>{code.role}</span></td>
                        <td>{[code.hasPassword ? "password" : null, code.emailDomain ? `@${code.emailDomain}` : null].filter(Boolean).join(" · ") || "None"}</td>
                        <td>{code.guestExpiresAfterDays ? `${code.guestExpiresAfterDays} days` : "Permanent"}</td>
                        <td>{code.lockedAt ? "Locked" : "Active"}</td>
                        <td>{isOwner ? <button className="auth-button ghost" type="button" onClick={() => void toggleCode(code)}>{code.lockedAt ? "Unlock" : "Lock"}</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="auth-empty"><h3>No organisation selected</h3></div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
