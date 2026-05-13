import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  requiredRole?: "admin" | "student";
}

/**
 * Auth + onboarding guard.
 *
 *   - No user                         → /login
 *   - User with required role mismatch → /
 *   - User with must_change_password   → /onboarding (and only /onboarding)
 *   - Anything else                    → render the route
 *
 * The onboarding redirect is here (not in Layout) so the protected pages
 * never render at all while the flag is set. This prevents a flash of
 * the dashboard before the redirect kicks in.
 */
export function ProtectedRoute({ requiredRole }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  // Forced onboarding: trap the user on /onboarding until they pick a
  // permanent password. Don't redirect if we're already there or we'd
  // bounce in a loop.
  const onOnboarding = location.pathname === "/onboarding";
  if (user.must_change_password && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  // Mirror: once they've cleared the flag, /onboarding has nothing useful.
  if (!user.must_change_password && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
