// AG Grid v35 requires modules to be registered before any grid mounts.
// Import this file ONLY from the DataGrid wrapper.

import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";

let registered = false;

export function ensureGridRegistered(): void {
  if (registered) return;
  ModuleRegistry.registerModules([AllCommunityModule]);
  registered = true;
}
