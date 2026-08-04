import { Navigate, useParams } from "react-router-dom";

/**
 * Legacy `/joins/:conn/:schema/:table` entry.
 * Spec 73 / UX-CATALOG-026 merges join maintenance into the table editor
 * `关联` tab; this route only redirects for bookmark compatibility.
 */
export function JoinEditor() {
  const params = useParams();
  const conn = params.conn ?? "";
  const schema = params.schema ?? "";
  const table = params.table ?? "";

  if (!conn || !schema || !table) {
    return <Navigate to="/catalog" replace />;
  }

  return (
    <Navigate
      replace
      to={`/catalog/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}?tab=joins`}
    />
  );
}
