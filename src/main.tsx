import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyPrefs } from "./lib/prefs";
import "./index.css";

try {
  if (localStorage.getItem("nphies-adt-theme") === "dark") document.documentElement.classList.add("dark");
} catch {
  /* storage can be blocked */
}

applyPrefs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
