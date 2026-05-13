import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Loader2 } from "lucide-react";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Login is needed immediately for unauthenticated users — keep eager.
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";

// All other pages are loaded on demand → much smaller initial bundle.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Profile = lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const Clubs = lazy(() => import("./pages/Clubs").then((m) => ({ default: m.Clubs })));
const ClubDetail = lazy(() => import("./pages/ClubDetail").then((m) => ({ default: m.ClubDetail })));
const Events = lazy(() => import("./pages/Events").then((m) => ({ default: m.Events })));
const Projects = lazy(() => import("./pages/Projects").then((m) => ({ default: m.Projects })));
const Workspace = lazy(() => import("./pages/Workspace").then((m) => ({ default: m.Workspace })));
const Chat = lazy(() => import("./pages/Chat").then((m) => ({ default: m.Chat })));
const Notifications = lazy(() => import("./pages/Notifications").then((m) => ({ default: m.Notifications })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

const lazyEl = (Component: React.LazyExoticComponent<ComponentType>) => (
  <Suspense fallback={<PageLoader />}>
    <Component />
  </Suspense>
);

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/forgot-password",
    element: <ForgotPassword />,
  },
  {
    path: "/reset-password",
    element: <ResetPassword />,
  },
  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: lazyEl(Dashboard) },
          { path: "profile", element: lazyEl(Profile) },
          { path: "clubs", element: lazyEl(Clubs) },
          { path: "clubs/:id", element: lazyEl(ClubDetail) },
          { path: "events", element: lazyEl(Events) },
          { path: "projects", element: lazyEl(Projects) },
          { path: "projects/:projectId/workspace", element: lazyEl(Workspace) },
          { path: "chats", element: lazyEl(Chat) },
          { path: "notifications", element: lazyEl(Notifications) },
          { path: "settings", element: lazyEl(Settings) },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
