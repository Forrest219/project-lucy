import { Navigate } from "react-router-dom";

export function AuditSources() {
  return <Navigate to="/admin/audit?tab=heatmap" replace />;
}
