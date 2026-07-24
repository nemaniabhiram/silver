import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DeploymentPage } from "./pages/DeploymentPage.js";
import { DropPage } from "./pages/DropPage.js";

export function App() {
  return (
    <BrowserRouter>
      <main className="mx-auto flex min-h-dvh w-full max-w-160 flex-col items-center justify-center px-6 py-24">
        <Routes>
          <Route path="/" element={<DropPage />} />
          <Route path="/d/:id" element={<DeploymentPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
