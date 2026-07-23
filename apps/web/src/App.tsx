import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { DeploymentPage } from "./pages/DeploymentPage.js";
import { DropPage } from "./pages/DropPage.js";

export function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-dvh flex-col">
        <header className="px-6 py-6">
          <Link to="/" className="text-body font-semibold tracking-tight">
            silver
          </Link>
        </header>

        <main className="mx-auto flex w-full max-w-160 flex-1 flex-col items-center justify-center px-6 pb-24">
          <Routes>
            <Route path="/" element={<DropPage />} />
            <Route path="/d/:id" element={<DeploymentPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
