import { relations } from "drizzle-orm";

import { organizationMembers } from "./tables/organization-members";
import { organizations } from "./tables/organizations";
import { provisioningEvents } from "./tables/provisioning-events";
import { users } from "./tables/users";

export const usersRelations = relations(users, ({ many }) => ({
	organizationMemberships: many(organizationMembers),
	provisioningEvents: many(provisioningEvents),
}));

export const organizationsRelations = relations(
	organizations,
	({ many, one }) => ({
		owner: one(users, {
			fields: [organizations.personalOwnerUserId],
			references: [users.id],
		}),
		memberships: many(organizationMembers),
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
