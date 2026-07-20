import { Routes, Route, Navigate } from "react-router";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Grants from "./pages/Grants";
import GrantEdit from "./pages/GrantEdit";
import GrantDetail from "./pages/GrantDetail";
import Clients from "./pages/Clients";
import ClientEdit from "./pages/ClientEdit";
import ClientDetail from "./pages/ClientDetail";
import Match from "./pages/Match";
import Cases from "./pages/Cases";
import CaseDetail from "./pages/CaseDetail";
import References from "./pages/References";
import IntakeShare from "./pages/IntakeShare";
import Radar from "./pages/Radar";

export default function App() {
  return (
    <Routes>
      {/* 客戶自填問卷：獨立版面，無側欄、無需登入 */}
      <Route path="/intake/:token" element={<IntakeShare />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/grants" element={<Grants />} />
        <Route path="/grants/new" element={<GrantEdit />} />
        <Route path="/grants/:id" element={<GrantDetail />} />
        <Route path="/grants/:id/edit" element={<GrantEdit />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/new" element={<ClientEdit />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/clients/:id/edit" element={<ClientEdit />} />
        <Route path="/match" element={<Match />} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
        <Route path="/references" element={<References />} />
        <Route path="/radar" element={<Radar />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
