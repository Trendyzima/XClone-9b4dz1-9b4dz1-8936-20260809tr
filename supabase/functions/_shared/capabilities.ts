export type CapabilityAccess = "public" | "authenticated";

export type CapabilityDefinition = {
  name: string;
  version: 1;
  access: CapabilityAccess;
  readonly: boolean;
  description: string;
};

/** Explicit capability registry. Unknown operations are never dynamically routed. */
export const CAPABILITIES = [
  { name: "testagram.capabilities.list", version: 1, access: "public", readonly: true, description: "List capabilities available to the caller." },
  { name: "testagram.health.read", version: 1, access: "public", readonly: true, description: "Read service-plane health." },
  { name: "testagram.posts.list", version: 1, access: "authenticated", readonly: true, description: "Read the authenticated user's visible post timeline page." },
  { name: "testagram.posts.create", version: 1, access: "authenticated", readonly: false, description: "Create a native Testagram post." },
  { name: "testagram.search.posts", version: 1, access: "authenticated", readonly: true, description: "Search visible posts using native PostgREST/RLS access." },
  { name: "testagram.search.users", version: 1, access: "authenticated", readonly: true, description: "Search visible profiles using native PostgREST/RLS access." },
  { name: "testagram.recommendations.generate", version: 1, access: "authenticated", readonly: false, description: "Generate the authenticated user's ranked recommendations." },
  { name: "testagram.notifications.rank", version: 1, access: "authenticated", readonly: true, description: "Read ranked notifications for the authenticated user." },
] as const satisfies readonly CapabilityDefinition[];

export type CapabilityName = (typeof CAPABILITIES)[number]["name"];

export function getCapability(name: string): CapabilityDefinition | undefined {
  return CAPABILITIES.find((capability) => capability.name === name);
}
