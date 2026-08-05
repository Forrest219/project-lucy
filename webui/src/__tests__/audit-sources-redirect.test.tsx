// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuditSources } from "../pages/admin/AuditSources";

describe("AuditSources shim (M35)", () => {
  it("redirects to /admin/audit", () => {
    render(
      <MemoryRouter initialEntries={["/admin/audit-sources"]}>
        <Routes>
          <Route
            path="/admin/audit"
            element={<div data-testid="redirect-target">REDIRECTED</div>}
          />
          <Route path="/admin/audit-sources" element={<AuditSources />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("redirect-target")).toBeInTheDocument();
  });
});
