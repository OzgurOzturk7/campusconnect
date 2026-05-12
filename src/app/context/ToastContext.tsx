import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import type { UserError } from "../lib/errors";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastPayload {
  title?: string;
  body: string;
  hint?: string;
  /** ms before auto-dismiss; 0 = sticky */
  duration?: number;
}

interface Toast extends ToastPayload {
  id: string;
  type: ToastType;
}

type ToastInput = string | ToastPayload | UserError;

interface ToastContextType {
  toast: (input: ToastInput, type?: ToastType) => void;
  success: (input: ToastInput) => void;
  error: (input: ToastInput) => void;
  warning: (input: ToastInput) => void;
  info: (input: ToastInput) => void;
  dismiss: (id?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);
const DEFAULT_DURATION = 4500;

function normalize(input: ToastInput): ToastPayload {
  if (typeof input === "string") return { body: input };
  // UserError shape — has body and may have title/hint.
  return input;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id?: string) => {
    setToasts((prev) => (id ? prev.filter((t) => t.id !== id) : []));
  }, []);

  const toast = useCallback(
    (input: ToastInput, type: ToastType = "info") => {
      const payload = normalize(input);
      const id = Math.random().toString(36).slice(2);
      const duration = payload.duration ?? DEFAULT_DURATION;
      setToasts((prev) => [...prev, { ...payload, id, type, duration }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  const success = useCallback((i: ToastInput) => toast(i, "success"), [toast]);
  const error = useCallback((i: ToastInput) => toast(i, "error"), [toast]);
  const warning = useCallback((i: ToastInput) => toast(i, "warning"), [toast]);
  const info = useCallback((i: ToastInput) => toast(i, "info"), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info, dismiss }}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2.5rem)]"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const styles: Record<
    ToastType,
    { container: string; iconColor: string; Icon: typeof Info; bar: string }
  > = {
    success: {
      container: "bg-card border-green-200/60 dark:border-green-500/30",
      iconColor: "text-green-600 dark:text-green-400",
      Icon: CheckCircle2,
      bar: "bg-green-500",
    },
    error: {
      container: "bg-card border-red-200/60 dark:border-red-500/30",
      iconColor: "text-red-600 dark:text-red-400",
      Icon: XCircle,
      bar: "bg-red-500",
    },
    warning: {
      container: "bg-card border-amber-200/60 dark:border-amber-500/30",
      iconColor: "text-amber-600 dark:text-amber-400",
      Icon: AlertTriangle,
      bar: "bg-amber-500",
    },
    info: {
      container: "bg-card border-blue-200/60 dark:border-blue-500/30",
      iconColor: "text-blue-600 dark:text-blue-400",
      Icon: Info,
      bar: "bg-blue-500",
    },
  };
  const s = styles[toast.type];
  const Icon = s.Icon;

  return (
    <div
      role="status"
      className={`pointer-events-auto relative flex items-start gap-3 pl-4 pr-3 py-3 rounded-xl border shadow-lg min-w-[300px] max-w-sm overflow-hidden ${s.container} animate-in slide-in-from-right-5 fade-in duration-200`}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${s.iconColor}`} />
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-semibold leading-snug">{toast.title}</p>
        )}
        <p className="text-sm leading-snug text-foreground/90">{toast.body}</p>
        {toast.hint && (
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            {toast.hint}
          </p>
        )}
      </div>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="flex-shrink-0 p-1 -mr-1 rounded-md text-muted-foreground hover:bg-muted transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      {toast.duration && toast.duration > 0 && (
        <ProgressBar duration={toast.duration} colorClass={s.bar} />
      )}
    </div>
  );
}

function ProgressBar({ duration, colorClass }: { duration: number; colorClass: string }) {
  const [width, setWidth] = useState(100);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    function tick(now: number) {
      const pct = Math.max(0, 100 - ((now - start) / duration) * 100);
      setWidth(pct);
      if (pct > 0) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);
  return (
    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/5 dark:bg-white/5">
      <div className={`h-full transition-[width] ${colorClass}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
