import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./app/routes";
import { AuthProvider } from "./app/context/AuthContext";
import { ThemeProvider } from "./app/context/ThemeContext";
import { LanguageProvider } from "./app/context/LanguageContext";
import "./app/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <LanguageProvider>
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  </LanguageProvider>
);