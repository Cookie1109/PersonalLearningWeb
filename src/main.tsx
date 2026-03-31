
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { configureAuthInterceptor } from "./api/client";
  import "./styles/index.css";

  configureAuthInterceptor();

  createRoot(document.getElementById("root")!).render(<App />);
  