import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Catalog } from "../pages/Catalog";
import { JoinEditor } from "../pages/JoinEditor";
import { Review } from "../pages/Review";
import { TableEditor } from "../pages/TableEditor";
import { WikiEditor } from "../pages/WikiEditor";

const queryClient = new QueryClient();

function breadcrumbItems(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) {
    return ["语义层维护", "表目录"];
  }
  if (parts[0] === "sources") {
    return ["语义层维护", parts[2] ?? "表语义", parts[3] ?? "表语义"];
  }
  if (parts[0] === "joins") {
    return ["语义层维护", "关联关系", parts[3] ?? "当前表"];
  }
  if (parts[0] === "wiki") {
    return ["业务文档", "Wiki 文档"];
  }
  if (parts[0] === "review") {
    return ["审阅与校验", "变更审阅"];
  }
  return ["KTX WebUI"];
}

function AppFrame() {
  const location = useLocation();
  const breadcrumbs = breadcrumbItems(location.pathname);

  return (
    <div className="workspace-shell">
      <aside className="primary-nav">
        <div className="brand-block">
          <strong>KTX WebUI</strong>
          <span>语义维护工作台</span>
        </div>

        <nav className="primary-nav-groups" aria-label="主导航">
          <section>
            <h2>语义层维护</h2>
            <NavLink to="/" end>表目录</NavLink>
          </section>
          <section>
            <h2>业务文档</h2>
            <NavLink to="/wiki">Wiki 文档</NavLink>
          </section>
          <section>
            <h2>审阅与校验</h2>
            <NavLink to="/review">变更审阅</NavLink>
          </section>
        </nav>
      </aside>

      <main className="workspace-main">
        <nav className="breadcrumbs" aria-label="当前位置">
          {breadcrumbs.map((item, index) => (
            <span key={`${index}-${item}`}>
              {index > 0 ? <span className="breadcrumb-separator">/</span> : null}
              {item}
            </span>
          ))}
        </nav>
        <Routes>
          <Route path="/" element={<Catalog />} />
          <Route path="/sources/:conn/:schema/:table" element={<TableEditor />} />
          <Route path="/joins/:conn/:schema/:table" element={<JoinEditor />} />
          <Route path="/review" element={<Review />} />
          <Route path="/wiki" element={<WikiEditor />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppFrame />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
