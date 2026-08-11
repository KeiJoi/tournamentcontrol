import { Route, Routes } from "react-router-dom";
import { TournamentPage } from "./TournamentPage.js";
import { MasterAdminPage } from "./MasterAdminPage.js";
function Home() { return <main><h1>Tournament Control</h1><p>Open a public tournament link to view its bracket.</p></main>; }
export function App() { return <Routes><Route path="/" element={<Home />} /><Route path="/t/:publicCode" element={<TournamentPage />} /><Route path="/admin/master" element={<MasterAdminPage />} /></Routes>; }
