import { createClerkClient } from "@clerk/backend";

export type ClerkUserProfile = {
	id: string;
	firstName: string | null;
	lastName: string | null;
	username: string | null;
	email: string | null;
	imageUrl: string | null;
};

export const formatClerkDisplayName = (input: {
	clerkUserId: string;
	firstName?: string | null;
	lastName?: string | null;
	username?: string | null;
	email?: string | null;
}) => {
	const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ");
	return fullName || input.username || input.email || input.clerkUserId;
};

export const buildPersonalOrganizationName = (
	profile: Pick<ClerkUserProfile, "firstName" | "username" | "email"> | null,
) => {
	if (!profile) {
		return "My Space";
	}

	const fallbackName = profile.username ?? profile.email?.split("@")[0] ?? "My";
	const name = profile.firstName?.trim() || fallbackName.trim() || "My";
	if (name === "My") {
		return "My Space";
	}

	return `${name}'s Space`;
};

export const fallbackClerkUserProfile = (
	clerkUserId: string,
): ClerkUserProfile => ({
	id: clerkUserId,
	firstName: null,
	lastName: null,
	username: null,
	email: null,
	imageUrl: null,
});

const nonEmptyStringOrNull = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
};

export const resolveClerkUserProfile = async (
	runtime: { clerkSecretKey: string | undefined },
	clerkUserId: string,
): Promise<ClerkUserProfile> => {
	if (!runtime.clerkSecretKey) {
		return fallbackClerkUserProfile(clerkUserId);
	}

	const clerkClient = createClerkClient({ secretKey: runtime.clerkSecretKey });
	const user = await clerkClient.users.getUser(clerkUserId);
	const primaryEmail =
		user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
			?.emailAddress ??
		user.emailAddresses[0]?.emailAddress ??
		null;

	return {
		id: user.id,
		firstName: nonEmptyStringOrNull(user.firstName),
		lastName: nonEmptyStringOrNull(user.lastName),
		username: nonEmptyStringOrNull(user.username),
		email: primaryEmail,
		imageUrl: user.imageUrl || null,
	};
};
