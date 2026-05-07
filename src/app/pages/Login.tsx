import { useState, FormEvent, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, Mail, ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const ALLOWED_EMAIL_DOMAIN = "final.edu.tr";

declare global {
  interface Window {
    google?: any;
  }
}

function NetworkCanvas({ density = 1, intensity = 1 }: { density?: number; intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let animId: number;
    const mouse = { x: -999, y: -999 };

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();

    type Node = { x: number; y: number; vx: number; vy: number; r: number; blue: boolean };
    const nodeCount = Math.round(64 * density);
    const nodes: Node[] = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 2.4 + 1.6,
      blue: Math.random() < 0.55,
    }));

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => { mouse.x = -999; mouse.y = -999; };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      nodes.forEach((n, i) => {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
        const dx = mouse.x - n.x, dy = mouse.y - n.y, d = Math.hypot(dx, dy);
        if (d < 110) { n.x -= dx * 0.018; n.y -= dy * 0.018; }

        nodes.slice(i + 1).forEach((m) => {
          const ed = Math.hypot(m.x - n.x, m.y - n.y);
          if (ed < 142) {
            const a = 1 - ed / 142;
            ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y);
            ctx.strokeStyle = n.blue
              ? `rgba(50,85,160,${a * 0.32 * intensity})`
              : `rgba(50,150,128,${a * 0.32 * intensity})`;
            ctx.lineWidth = 0.75;
            ctx.stroke();
          }
        });

        // soft glow halo
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3.5);
        grad.addColorStop(0, n.blue ? `rgba(50,85,160,${0.22 * intensity})` : `rgba(50,150,128,${0.24 * intensity})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.blue ? `rgba(50,85,160,${0.65 * intensity})` : `rgba(50,150,128,${0.68 * intensity})`;
        ctx.fill();
      });
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

export function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(!GOOGLE_CLIENT_ID);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(email, password, remember);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const scriptId = "google-identity-services";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const init = () => {
      if (!window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response: { credential: string }) => {
          setError(null);
          setIsLoading(true);
          try {
            // Quick client-side domain hint (final check is on backend)
            const payload = JSON.parse(atob(response.credential.split(".")[1]));
            if (payload.email && !payload.email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
              throw new Error(`Only @${ALLOWED_EMAIL_DOMAIN} accounts are allowed.`);
            }
            await loginWithGoogle(response.credential, remember);
            navigate("/", { replace: true });
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Google sign-in failed.");
          } finally {
            setIsLoading(false);
          }
        },
        hosted_domain: ALLOWED_EMAIL_DOMAIN,
        ux_mode: "popup",
        auto_select: false,
      });

      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: 360,
      });
    };

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = init;
      document.body.appendChild(script);
    } else if (window.google) {
      init();
    } else {
      script.addEventListener("load", init);
    }
  }, [loginWithGoogle, navigate, remember]);

  const fieldBase: React.CSSProperties = {
    border: "2px solid #cce0f5",
    background: "#f0f8ff",
    color: "#1a3a8f",
    fontFamily: "'Outfit', sans-serif",
  };

  return (
    <div className="min-h-screen flex overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col items-center justify-center w-[52%] relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #c2dcf6 0%, #ceeaec 55%, #c2e9dd 100%)" }}
      >
        <NetworkCanvas />

        <div className="relative z-10 flex flex-col items-center text-center px-12">
          <img
            src="/logo.png"
            alt="CampusConnect"
            fetchPriority="high"
            decoding="async"
            style={{
              width: "620px",
              maxWidth: "94%",
              height: "auto",
              objectFit: "contain",
              marginBottom: "24px",
            }}
          />
        </div>
      </div>

      {/* ── Right panel ── */}
      <div
        className="flex-1 flex items-center justify-center p-10 relative overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #e6f1ff 0%, #e0f3ec 100%)",
          borderLeft: "1px solid rgba(26,58,143,0.08)",
        }}
      >
        {/* Subtle particles in the right panel — lighter density & intensity */}
        <NetworkCanvas density={0.45} intensity={0.6} />

        <div
          className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle,rgba(26,173,130,0.22) 0%,transparent 70%)" }}
        />
        <div
          className="absolute -bottom-12 -left-12 w-44 h-44 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle,rgba(26,58,143,0.16) 0%,transparent 70%)" }}
        />

        <div
          className="w-full max-w-lg relative z-10 rounded-3xl px-11 py-12 cc-fade-in"
          style={{
            background: "rgba(255,255,255,0.55)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow: "0 25px 70px -18px rgba(26,58,143,0.22), 0 10px 30px -12px rgba(26,173,130,0.14)",
          }}
        >

          <div className="lg:hidden flex justify-center mb-8">
            <img
              src="/logo.png"
              alt="CampusConnect"
              decoding="async"
              style={{ height: "40px", objectFit: "contain" }}
            />
          </div>

          <h2
            className="text-4xl font-extrabold mb-1 tracking-tight"
            style={{
              backgroundImage: "linear-gradient(135deg, #1a3a8f 0%, #2176c7 50%, #1aad82 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Welcome
          </h2>
          <p className="text-sm mb-7" style={{ color: "#6a9abf" }}>
            {showEmailForm ? "Sign in with your university credentials" : "Sign in to continue to CampusConnect"}
          </p>

          {error && (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 mb-5 text-sm border cc-pop-in"
              style={{ background: "#fff5f5", borderColor: "#fca5a5", color: "#c44444" }}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* ── Primary view: Google ── (kept mounted so the GIS button persists) */}
          {GOOGLE_CLIENT_ID && (
            <div style={{ display: showEmailForm ? "none" : "block" }} className="cc-pop-in">
              <div className="flex justify-center">
                <div ref={googleBtnRef} />
              </div>

              <div
                className="flex items-center justify-center gap-1.5 mt-3 px-3 py-1.5 rounded-full mx-auto w-fit"
                style={{ background: "rgba(26,173,130,0.08)", color: "#1aad82" }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-wide">
                  Secured by Google · @{ALLOWED_EMAIL_DOMAIN} only
                </span>
              </div>

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px" style={{ background: "#cce0f5" }} />
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#a0bbd0" }}>
                  or
                </span>
                <div className="flex-1 h-px" style={{ background: "#cce0f5" }} />
              </div>

              <button
                type="button"
                onClick={() => { setError(null); setShowEmailForm(true); }}
                className="w-full py-3 rounded-2xl text-sm font-semibold border-2 flex items-center justify-center gap-2 transition-all hover:bg-white hover:-translate-y-0.5"
                style={{ borderColor: "#cce0f5", background: "rgba(255,255,255,0.6)", color: "#1a3a8f" }}
              >
                <Mail className="w-4 h-4" />
                Sign in with email
              </button>
            </div>
          )}

          {/* ── Email/password view ── */}
          {showEmailForm && (
            <div className="cc-pop-in">
              {GOOGLE_CLIENT_ID && (
                <button
                  type="button"
                  onClick={() => { setError(null); setShowEmailForm(false); }}
                  className="flex items-center gap-1.5 text-xs font-semibold mb-5 transition-colors hover:underline"
                  style={{ color: "#1aad82" }}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Use Google instead
                </button>
              )}

              <form onSubmit={handleSubmit}>
                <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#a0bbd0" }}>
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@university.edu"
                  required
                  autoComplete="email"
                  disabled={isLoading}
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all mb-5 disabled:opacity-60"
                  style={fieldBase}
                  onFocus={(e) => { e.target.style.borderColor = "#1a3a8f"; e.target.style.background = "white"; }}
                  onBlur={(e) => { e.target.style.borderColor = "#cce0f5"; e.target.style.background = "#f0f8ff"; }}
                />

                <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#a0bbd0" }}>
                  Password
                </label>
                <div className="relative mb-2">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    disabled={isLoading}
                    className="w-full px-4 py-3 pr-12 rounded-xl text-sm outline-none transition-all disabled:opacity-60"
                    style={fieldBase}
                    onFocus={(e) => { e.target.style.borderColor = "#1aad82"; e.target.style.background = "white"; }}
                    onBlur={(e) => { e.target.style.borderColor = "#cce0f5"; e.target.style.background = "#f0f8ff"; }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#a0bbd0" }}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center py-3 mb-3">
                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "#4a7aaa" }}>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="w-3.5 h-3.5"
                      style={{ accentColor: "#1a3a8f" }}
                    />
                    Remember me
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !email || !password}
                  className="w-full py-3.5 rounded-2xl text-sm font-bold text-white relative overflow-hidden transition-transform disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #1a3a8f 0%, #2176c7 50%, #1aad82 100%)", fontFamily: "'Outfit', sans-serif" }}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing in...
                    </span>
                  ) : "Sign In"}
                </button>
              </form>
            </div>
          )}

          <p className="text-center text-xs mt-6" style={{ color: "#8aadcc" }}>
            No account?{" "}
            <span className="font-semibold" style={{ color: "#1aad82" }}>
              Contact your university admin.
            </span>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes cc-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cc-fade-in {
          animation: cc-fade-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes cc-pop-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cc-pop-in {
          animation: cc-pop-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
    </div>
  );
}