import { useState, FormEvent, useEffect, useRef, MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router";
import { Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, Mail, ArrowLeft, Sparkles, CheckCircle2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const ALLOWED_EMAIL_DOMAIN = "final.edu.tr";

declare global { interface Window { google?: any; } }

// Module-level guard. `google.accounts.id.initialize()` is process-global —
// calling it twice triggers the `[GSI_LOGGER]: ...called multiple times` warning.
// A per-component ref doesn't survive Login unmount/remount (sign-out → sign-in,
// or React StrictMode's double-invoke in dev), so we track init state here.
// We still re-render the button on every mount because the DOM node is fresh.
let gsiInitialized = false;
// The callback closes over component state (setError/setIsLoading/navigate),
// so we keep a mutable reference that the one-time `initialize` callback hits.
let gsiCallback: ((response: { credential: string }) => void) | null = null;

// =============================================================================
// 1) Constellation — particles that connect to nearby cursor with smooth lines
// =============================================================================
function Constellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const mouse = { x: -9999, y: -9999, active: false };

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    type P = { x: number; y: number; vx: number; vy: number; r: number; baseR: number; hue: number };
    const w = () => canvas.offsetWidth;
    const h = () => canvas.offsetHeight;

    const particles: P[] = Array.from({ length: 70 }, () => ({
      x: Math.random() * w(),
      y: Math.random() * h(),
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: 1.5 + Math.random() * 1.5,
      baseR: 1.5 + Math.random() * 1.5,
      hue: 260 + Math.random() * 30,
    }));

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    };
    const onLeave = () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, w(), h());

      particles.forEach((p) => {
        // gentle drift
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w()) p.vx *= -1;
        if (p.y < 0 || p.y > h()) p.vy *= -1;

        // attract slightly toward cursor when close
        if (mouse.active) {
          const dx = mouse.x - p.x, dy = mouse.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 180) {
            p.x += dx * 0.005;
            p.y += dy * 0.005;
            p.r = p.baseR + (1 - d / 180) * 2;
          } else {
            p.r += (p.baseR - p.r) * 0.1;
          }
        } else {
          p.r += (p.baseR - p.r) * 0.1;
        }

        // particle dot with soft glow
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        grad.addColorStop(0, `hsla(${p.hue}, 80%, 60%, 0.4)`);
        grad.addColorStop(1, `hsla(${p.hue}, 80%, 60%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = `hsla(${p.hue}, 80%, 55%, 0.85)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      });

      // connecting lines — particle to particle (only nearby)
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 110) {
            const alpha = (1 - d / 110) * 0.18;
            ctx.strokeStyle = `hsla(265, 80%, 60%, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }

      // connecting lines — cursor to nearby particles (highlight)
      if (mouse.active) {
        particles.forEach((p) => {
          const d = Math.hypot(mouse.x - p.x, mouse.y - p.y);
          if (d < 180) {
            const alpha = (1 - d / 180) * 0.5;
            ctx.strokeStyle = `hsla(265, 90%, 60%, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(mouse.x, mouse.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          }
        });
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-auto" />;
}

// =============================================================================
// 2) Morphing SVG blobs (smoother than CSS — uses interpolated path animation)
// =============================================================================
function MorphBlob({ className, color, dur }: { className?: string; color: string; dur: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} style={{ pointerEvents: "none" }}>
      <defs>
        <radialGradient id={`grad-${color.replace(/[^\w]/g, "")}`}>
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="70%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path fill={`url(#grad-${color.replace(/[^\w]/g, "")})`}>
        <animate
          attributeName="d"
          dur={dur}
          repeatCount="indefinite"
          values="
            M44.4,-58.6C56.7,-49.3,65.5,-34.6,69.3,-18.7C73.1,-2.8,72,14.3,64.6,28.5C57.2,42.7,43.6,53.9,28.4,60.3C13.2,66.6,-3.7,68.1,-19.5,63.7C-35.3,59.4,-50.1,49.1,-59.8,35.1C-69.5,21.1,-74.2,3.3,-71.8,-13.4C-69.4,-30,-59.8,-45.5,-46.5,-54.5C-33.2,-63.6,-16.6,-66.1,-0.2,-65.9C16.3,-65.7,32.6,-67.9,44.4,-58.6Z;
            M40.7,-55.5C53.3,-44.5,64.4,-32.6,68.5,-18.5C72.6,-4.4,69.7,11.9,62.5,26.4C55.4,40.9,44,53.6,29.7,60.6C15.4,67.6,-1.8,68.8,-18.2,64.5C-34.6,60.1,-50.2,50.2,-60.2,36.4C-70.2,22.7,-74.5,5.1,-71.4,-11.1C-68.3,-27.4,-57.7,-42.4,-44.2,-53.7C-30.7,-65,-15.4,-72.6,-0.3,-72.2C14.8,-71.8,28.2,-66.5,40.7,-55.5Z;
            M44.4,-58.6C56.7,-49.3,65.5,-34.6,69.3,-18.7C73.1,-2.8,72,14.3,64.6,28.5C57.2,42.7,43.6,53.9,28.4,60.3C13.2,66.6,-3.7,68.1,-19.5,63.7C-35.3,59.4,-50.1,49.1,-59.8,35.1C-69.5,21.1,-74.2,3.3,-71.8,-13.4C-69.4,-30,-59.8,-45.5,-46.5,-54.5C-33.2,-63.6,-16.6,-66.1,-0.2,-65.9C16.3,-65.7,32.6,-67.9,44.4,-58.6Z
          "
        />
        <animateTransform attributeName="transform" type="translate" values="100 100" />
      </path>
    </svg>
  );
}

// =============================================================================
// 3) Cursor spotlight — soft glow follows cursor
// =============================================================================
function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const move = (e: MouseEvent) => {
      el.style.setProperty("--cx", `${e.clientX}px`);
      el.style.setProperty("--cy", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);
  return (
    <div
      ref={ref}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ background: "radial-gradient(circle 520px at var(--cx, 50%) var(--cy, 50%), rgba(167,139,250,0.16), transparent 65%)" }}
    />
  );
}

// =============================================================================
// 4) Click ripple
// =============================================================================
function useRipples() {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const idRef = useRef(0);
  const onClick = (e: ReactMouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const id = idRef.current++;
    setRipples((p) => [...p, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    setTimeout(() => setRipples((p) => p.filter((x) => x.id !== id)), 900);
  };
  const layer = (
    <>
      {ripples.map((r) => (
        <span
          key={r.id}
          className="absolute rounded-full pointer-events-none z-50"
          style={{
            left: r.x, top: r.y, width: 0, height: 0,
            transform: "translate(-50%, -50%)",
            animation: "cc-ripple 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards",
            background: "radial-gradient(circle, rgba(167,139,250,0.45), rgba(167,139,250,0))",
          }}
        />
      ))}
    </>
  );
  return { onClick, layer };
}

// =============================================================================
// 5) 3D tilting glass card with internal depth layers
// =============================================================================
function TiltCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: ReactMouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    el.style.transform = `perspective(1000px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg) translateZ(0)`;
    // Move shine highlight
    el.style.setProperty("--shine-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--shine-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "perspective(1000px) rotateY(0deg) rotateX(0deg)";
  };
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="w-full max-w-md relative z-10 cc-fade-in"
      style={{
        transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        transformStyle: "preserve-3d",
      }}
    >
      {/* Outer soft glow */}
      <div
        className="absolute -inset-2 rounded-[28px] pointer-events-none"
        style={{
          background: "linear-gradient(135deg, rgba(124,58,237,0.4), rgba(167,139,250,0.4))",
          filter: "blur(28px)",
          opacity: 0.6,
          transform: "translateZ(-30px)",
        }}
      />

      {/* Glass card */}
      <div
        className="relative rounded-3xl px-10 py-11 overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.72)",
          backdropFilter: "blur(22px) saturate(180%)",
          WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.6)",
          boxShadow: "0 30px 80px -20px rgba(124,58,237,0.32), 0 12px 35px -12px rgba(167,139,250,0.22), inset 0 1px 0 rgba(255,255,255,0.85)",
        }}
      >
        {/* Specular shine that follows cursor */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(circle 220px at var(--shine-x, 50%) var(--shine-y, 50%), rgba(255,255,255,0.55), transparent 60%)",
            mixBlendMode: "soft-light",
          }}
        />
        {/* Subtle grain for premium texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative" style={{ transform: "translateZ(40px)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 6) Magnetic wrapper
// =============================================================================
function Magnetic({ children, strength = 12 }: { children: React.ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: ReactMouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width - 0.5) * strength;
    const y = ((e.clientY - r.top) / r.height - 0.5) * strength;
    el.style.transform = `translate(${x}px, ${y}px)`;
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = "translate(0, 0)"; };
  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} style={{ transition: "transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)" }}>
      {children}
    </div>
  );
}

// =============================================================================
// 7) Letter-by-letter staggered reveal
// =============================================================================
function StaggeredText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className} style={style}>
      {text.split("").map((ch, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            opacity: 0,
            transform: "translateY(14px)",
            animation: `cc-letter 0.65s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.04}s forwards`,
          }}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

// =============================================================================
// 8) Rotating tagline
// =============================================================================
function RotatingTagline() {
  const lines = ["Connect.", "Discover.", "Build together.", "Shine."];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setIdx((p) => (p + 1) % lines.length), 2400);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="relative h-8 overflow-hidden">
      {lines.map((l, i) => (
        <div
          key={i}
          className="absolute inset-0 flex items-center justify-center transition-all duration-500"
          style={{
            color: "#5b21b6", fontSize: "1.2rem", fontWeight: 600, letterSpacing: "0.04em",
            opacity: idx === i ? 1 : 0,
            transform: `translateY(${idx === i ? 0 : idx > i ? -28 : 28}px)`,
          }}
        >
          {l}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MAIN
// =============================================================================
export function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Always persist session (Remember me removed — sessions persist across reloads)
  const remember = true;
  const [showEmailForm, setShowEmailForm] = useState(!GOOGLE_CLIENT_ID);
  // When Google sign-in resolves to "invited" the backend emailed a temp
  // password and refused to issue a session. We park the email here and
  // render an inbox-check view instead of bouncing to /.
  const [invitedView, setInvitedView] = useState<{ email: string; emailFailed: boolean } | null>(null);
  const rememberRef = useRef(false);
  useEffect(() => { rememberRef.current = remember; }, [remember]);

  const ripples = useRipples();

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

    // Bind the current closure to the module-level callback slot.
    // GSI calls our single registered callback; we forward to whatever Login
    // instance is currently mounted.
    gsiCallback = async (response) => {
      setError(null); setIsLoading(true);
      try {
        const payload = JSON.parse(atob(response.credential.split(".")[1]));
        if (payload.email && !payload.email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
          throw new Error(`Only @${ALLOWED_EMAIL_DOMAIN} accounts are allowed.`);
        }
        const result = await loginWithGoogle(response.credential, rememberRef.current);
        if (result.kind === "invited") {
          // Backend emailed a temp password. Drop the user straight onto
          // the email form with their address pre-filled and a banner
          // explaining what to do — less jarring than a full-page takeover.
          setInvitedView({ email: result.email, emailFailed: result.emailFailed });
          setEmail(result.email);
          setShowEmailForm(true);
        } else {
          navigate("/", { replace: true });
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Google sign-in failed.");
      } finally { setIsLoading(false); }
    };

    const init = () => {
      if (!window.google || !googleBtnRef.current) return;
      if (!gsiInitialized) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: { credential: string }) => gsiCallback?.(response),
          hosted_domain: ALLOWED_EMAIL_DOMAIN,
          ux_mode: "popup",
          auto_select: false,
        });
        gsiInitialized = true;
      }
      // Always re-render the button: the DOM node is fresh on each mount.
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard", theme: "outline", size: "large",
        text: "continue_with", shape: "rectangular", logo_alignment: "left", width: 360,
      });
    };
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true; script.defer = true; script.onload = init;
      document.body.appendChild(script);
    } else if (window.google) { init(); }
    else { script.addEventListener("load", init); }

    return () => {
      // Unbind so a stale callback can't fire into an unmounted component.
      gsiCallback = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldBase: React.CSSProperties = {
    border: "2px solid #e9d5ff",
    background: "#faf5ff",
    color: "#3b0764",
    fontFamily: "'Outfit', sans-serif",
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row overflow-hidden relative"
      style={{ fontFamily: "'Outfit', sans-serif" }}
      onClick={ripples.onClick}
    >
      <CursorSpotlight />

      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col items-center justify-center w-[52%] relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #e9d5ff 100%)" }}
      >
        {/* Morphing fluid blobs */}
        <div className="absolute" style={{ width: 700, height: 700, top: "-15%", left: "-15%", animation: "cc-blob-drift1 22s ease-in-out infinite" }}>
          <MorphBlob className="w-full h-full" color="#a78bfa" dur="9s" />
        </div>
        <div className="absolute" style={{ width: 600, height: 600, bottom: "-10%", right: "-10%", animation: "cc-blob-drift2 26s ease-in-out infinite" }}>
          <MorphBlob className="w-full h-full" color="#7c3aed" dur="11s" />
        </div>
        <div className="absolute" style={{ width: 500, height: 500, top: "30%", right: "-5%", animation: "cc-blob-drift3 30s ease-in-out infinite" }}>
          <MorphBlob className="w-full h-full" color="#c4b5fd" dur="13s" />
        </div>

        {/* Constellation particles */}
        <Constellation />

        {/* Logo + content */}
        <div className="relative z-10 flex flex-col items-center text-center px-12">
          <div className="cc-logo-wrap">
            <img
              src="/logo.png"
              alt="CampusConnect"
              decoding="async"
              style={{
                width: "620px", maxWidth: "94%", height: "auto", objectFit: "contain",
                marginBottom: "18px",
                filter: "drop-shadow(0 18px 40px rgba(124,58,237,0.32))",
                animation: "cc-logo-float 6s ease-in-out infinite",
              }}
            />
          </div>
          <RotatingTagline />
        </div>
      </div>

      {/* ── Right panel ── */}
      <div
        className="flex-1 flex items-center justify-center p-6 lg:p-10 relative overflow-hidden min-h-screen lg:min-h-0"
        style={{
          background: "linear-gradient(160deg, #fefcff 0%, #f5f3ff 100%)",
          borderLeft: "1px solid rgba(124,58,237,0.06)",
        }}
      >
        {/* Decorative blob in right panel — subtle */}
        <div className="absolute" style={{ width: 500, height: 500, top: "-10%", right: "-15%", opacity: 0.6 }}>
          <MorphBlob className="w-full h-full" color="#c4b5fd" dur="14s" />
        </div>

        {/* Mobile logo */}
        <div className="lg:hidden absolute top-8 left-1/2 -translate-x-1/2">
          <img src="/logo.png" alt="CampusConnect" decoding="async" style={{ height: "44px", objectFit: "contain" }} />
        </div>

        <TiltCard>
          <h2
            className="text-4xl font-extrabold mb-1 tracking-tight"
            style={{
              backgroundImage: "linear-gradient(135deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            <StaggeredText text="Welcome" />
          </h2>
          <p className="text-sm mb-7 flex items-center gap-1.5" style={{ color: "#6d28d9" }}>
            <Sparkles className="w-3.5 h-3.5" />
            {showEmailForm ? "Sign in with your university credentials" : "Sign in to continue to CampusConnect"}
          </p>

          {error && (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 mb-5 text-sm border cc-pop-in"
              style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Google view */}
          {GOOGLE_CLIENT_ID && (
            <div style={{ display: showEmailForm ? "none" : "block" }} className="cc-pop-in">
              <Magnetic>
                <div className="flex justify-center"><div ref={googleBtnRef} /></div>
              </Magnetic>

              <div className="flex items-center justify-center gap-1.5 mt-3 px-3 py-1.5 rounded-full mx-auto w-fit"
                style={{ background: "rgba(124,58,237,0.1)", color: "#6d28d9" }}>
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-wide">
                  Secured by Google · @{ALLOWED_EMAIL_DOMAIN} only
                </span>
              </div>

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, #ddd6fe, transparent)" }} />
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#a78bfa" }}>or</span>
                <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, #ddd6fe, transparent)" }} />
              </div>

              <button
                type="button"
                onClick={() => { setError(null); setShowEmailForm(true); }}
                className="w-full py-3 rounded-2xl text-sm font-semibold border-2 flex items-center justify-center gap-2 transition-all hover:bg-white hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: "#e9d5ff", background: "rgba(255,255,255,0.55)", color: "#6d28d9" }}
              >
                <Mail className="w-4 h-4" />
                Sign in with email
              </button>
            </div>
          )}

          {/* Email view */}
          {showEmailForm && (
            <div className="cc-pop-in">
              {GOOGLE_CLIENT_ID && (
                <button type="button" onClick={() => { setError(null); setShowEmailForm(false); setInvitedView(null); }}
                  className="flex items-center gap-1.5 text-xs font-semibold mb-5 transition-colors hover:underline"
                  style={{ color: "#7c3aed" }}>
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Use Google instead
                </button>
              )}

              {/* Invite banner — shown after a first-time Google sign-in.
                  Tells the user a temp password just hit their inbox and
                  what to do with it. Dismissed when they navigate away or
                  successfully sign in. */}
              {invitedView && (
                <div
                  className="flex items-start gap-3 rounded-xl px-4 py-3 mb-5 border cc-pop-in"
                  style={
                    invitedView.emailFailed
                      ? { background: "#fef3c7", borderColor: "#fcd34d", color: "#92400e" }
                      : { background: "rgba(124,58,237,0.08)", borderColor: "#ddd6fe", color: "#5b21b6" }
                  }
                >
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs leading-relaxed">
                    {invitedView.emailFailed ? (
                      <>
                        <span className="font-bold block mb-0.5">Account created, but the email couldn't be sent.</span>
                        Ask the admin for your temporary password or use "Forgot password?" to set one yourself.
                      </>
                    ) : (
                      <>
                        <span className="font-bold block mb-0.5">A temporary password was sent to <span className="break-all">{invitedView.email}</span>.</span>
                        Check your inbox (and spam folder), paste the password below, and sign in.
                      </>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#a78bfa" }}>
                  Email Address
                </label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@final.edu.tr" required autoComplete="email" disabled={isLoading} autoFocus
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all mb-5 disabled:opacity-60"
                  style={fieldBase}
                  onFocus={(e) => { e.target.style.borderColor = "#7c3aed"; e.target.style.background = "white"; e.target.style.boxShadow = "0 0 0 4px rgba(124,58,237,0.12)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "#e9d5ff"; e.target.style.background = "#faf5ff"; e.target.style.boxShadow = "none"; }}
                />

                <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#a78bfa" }}>
                  Password
                </label>
                <div className="relative mb-2">
                  <input
                    type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" required autoComplete="current-password" disabled={isLoading}
                    className="w-full px-4 py-3 pr-12 rounded-xl text-sm outline-none transition-all disabled:opacity-60"
                    style={fieldBase}
                    onFocus={(e) => { e.target.style.borderColor = "#a78bfa"; e.target.style.background = "white"; e.target.style.boxShadow = "0 0 0 4px rgba(167,139,250,0.18)"; }}
                    onBlur={(e) => { e.target.style.borderColor = "#e9d5ff"; e.target.style.background = "#faf5ff"; e.target.style.boxShadow = "none"; }}
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors hover:opacity-70" style={{ color: "#a78bfa" }}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex justify-end mb-2">
                  <button
                    type="button"
                    onClick={() => navigate("/forgot-password")}
                    className="text-xs font-semibold hover:underline transition-colors"
                    style={{ color: "#7c3aed" }}
                  >
                    Forgot password?
                  </button>
                </div>

                <Magnetic strength={5}>
                  <button
                    type="submit" disabled={isLoading || !email || !password}
                    className="w-full py-3.5 rounded-2xl text-sm font-bold text-white relative overflow-hidden transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-xl group"
                    style={{
                      background: "linear-gradient(135deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%)",
                      backgroundSize: "200% 100%",
                      fontFamily: "'Outfit', sans-serif",
                      boxShadow: "0 12px 30px -10px rgba(124,58,237,0.55)",
                    }}
                    onMouseMove={(e) => { (e.currentTarget as HTMLElement).style.backgroundPosition = `${(e.nativeEvent.offsetX / e.currentTarget.offsetWidth) * 100}% 50%`; }}
                  >
                    <span className="relative z-10">
                      {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Signing in...
                        </span>
                      ) : "Sign In"}
                    </span>
                  </button>
                </Magnetic>
              </form>
            </div>
          )}

          <p className="text-center text-xs mt-6" style={{ color: "#a78bfa" }}>
            No account?{" "}
            <span className="font-semibold" style={{ color: "#7c3aed" }}>
              Contact your university admin.
            </span>
          </p>
        </TiltCard>

        {ripples.layer}
      </div>

      <style>{`
        @keyframes cc-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cc-fade-in { animation: cc-fade-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }

        @keyframes cc-pop-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cc-pop-in { animation: cc-pop-in 0.36s cubic-bezier(0.22, 1, 0.36, 1) both; }

        @keyframes cc-fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes cc-letter {
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes cc-logo-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-10px); }
        }

        @keyframes cc-blob-drift1 {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          33%      { transform: translate(40px, -25px) rotate(8deg); }
          66%      { transform: translate(-25px, 35px) rotate(-6deg); }
        }
        @keyframes cc-blob-drift2 {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          33%      { transform: translate(-35px, 30px) rotate(-7deg); }
          66%      { transform: translate(45px, -20px) rotate(9deg); }
        }
        @keyframes cc-blob-drift3 {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          50%      { transform: translate(-30px, 40px) rotate(5deg); }
        }

        @keyframes cc-ripple {
          0%   { width: 0; height: 0; opacity: 0.7; }
          100% { width: 700px; height: 700px; opacity: 0; }
        }

        .cc-logo-wrap:hover img {
          filter: drop-shadow(0 25px 60px rgba(124,58,237,0.5)) brightness(1.05);
        }
      `}</style>
    </div>
  );
}

