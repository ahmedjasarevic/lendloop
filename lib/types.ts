import type { FunctionReturnType } from "convex/server";

import type { api } from "@/convex/_generated/api";

export type Viewer = NonNullable<FunctionReturnType<typeof api.users.viewer>>;
export type ToolView = FunctionReturnType<typeof api.tools.listAvailable>[number];
export type MyToolView = FunctionReturnType<typeof api.tools.listMine>[number];
export type AdminToolView = FunctionReturnType<typeof api.tools.listAllForAdmin>[number];
export type AdminUserView = FunctionReturnType<typeof api.users.list>[number];
export type LoanView = FunctionReturnType<typeof api.loans.listIncoming>[number];
export type PublicToolView = FunctionReturnType<typeof api.tools.listPublic>[number];

export type LoanActivity = LoanView["recentActivity"][number];
