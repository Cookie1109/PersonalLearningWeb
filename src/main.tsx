
  import { createRoot } from "react-dom/client";
  import App from "./app/App";
  import { configureAuthInterceptor } from "./api/client";
  import "./styles/index.css";

  const THEME_STORAGE_KEY = "nexl-theme-mode";

  const bootstrapThemeMode = () => {
    const root = document.documentElement;
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const mode = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    root.classList.toggle("dark", mode === "dark");
    root.setAttribute("data-theme", mode);
  };

  bootstrapThemeMode();

  configureAuthInterceptor();

  createRoot(document.getElementById("root")!).render(<App />);
  