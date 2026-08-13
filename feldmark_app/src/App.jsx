import { Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./app/Sidebar.jsx";
import PfaendungAuskunftsersuchenFeature from "./features/pfaendung-auskunftsersuchen/PfaendungAuskunftsersuchenFeature.jsx";

export default function App() {
  return (
    <div className="shell">
      <Sidebar />
      <main className="shell__main">
        <Routes>
          <Route path="/" element={<Navigate to="/pfaendung-auskunftsersuchen" replace />} />
          <Route path="/pfaendung-auskunftsersuchen" element={<PfaendungAuskunftsersuchenFeature />} />
        </Routes>
      </main>
    </div>
  );
}
