import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "./app/lib/i18n";
import { router } from "./app/routes";
import { AuthProvider } from "./app/context/AuthContext";
import { ThemeProvider } from "./app/context/ThemeContext";
import { LanguageProvider } from "./app/context/LanguageContext";
import { NotificationProvider } from "./app/context/NotificationContext";
import { ToastProvider } from "./app/context/ToastContext";
import { ConfirmProvider } from "./app/context/ConfirmContext";
import "./app/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <LanguageProvider>
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <NotificationProvider>
              <RouterProvider router={router} />
            </NotificationProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  </LanguageProvider>
);
