import { relations } from "drizzle-orm";

import { evidenceArtifacts } from "./tables/evidence-artifacts";
import { evidences } from "./tables/evidences";
import { organizationMembers } from "./tables/organization-members";
import { organizations } from "./tables/organizations";
import { provisioningEvents } from "./tables/provisioning-events";
import { shareLinks } from "./tables/share-links";
import { users } from "./tables/users";

export const usersRelations = relations(users, ({ many }) => ({
	organizationMemberships: many(organizationMembers),
	provisioningEvents: many(provisioningEvents),
	createdEvidences: many(evidences),
	createdShareLinks: many(shareLinks),
}));

export const organizationsRelations = relations(
	organizations,
	({ many, one }) => ({
		owner: one(users, {
			fields: [organizations.personalOwnerUserId],
			references: [users.id],
		}),
		memberships: many(organizationMembers),
		evidences: many(evidences),
		shareLinks: many(shareLinks),
	}),
);

export const organizationMembersRelations = relations(
	organizationMembers,
	({ one }) => ({
		organization: one(organizations, {
			fields: [organizationMembers.organizationId],
			references: [organizations.id],
		}),
		user: one(users, {
			fields: [organizationMembers.userId],
			references: [users.id],
		}),
	}),
);

export const provisioningEventsRelations = relations(
	provisioningEvents,
	({ one }) => ({
		user: one(users, {
			fields: [provisioningEvents.userId],
			references: [users.id],
		}),
	}),
);

export const evidencesRelations = relations(evidences, ({ many, one }) => ({
	organization: one(organizations, {
		fields: [evidences.orgId],
		references: [organizations.id],
	}),
	createdByUser: one(users, {
		fields: [evidences.createdBy],
		references: [users.id],
	}),
	artifacts: many(evidenceArtifacts),
	shareLinks: many(shareLinks),
}));

export const evidenceArtifactsRelations = relations(
	evidenceArtifacts,
	({ one }) => ({
		evidence: one(evidences, {
			fields: [evidenceArtifacts.evidenceId],
			references: [evidences.id],
		}),
	}),
);

export const shareLinksRelations = relations(shareLinks, ({ one }) => ({
	evidence: one(evidences, {
		fields: [shareLinks.evidenceId],
		references: [evidences.id],
	}),
	organization: one(organizations, {
		fields: [shareLinks.orgId],
		references: [organizations.id],
	}),
	createdByUser: one(users, {
		fields: [shareLinks.createdBy],
		references: [users.id],
	}),
}));
