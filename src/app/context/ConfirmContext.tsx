import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ConfirmTone = "default" | "danger" | "warning";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: Omit<ConfirmOptions, "cancelLabel">) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

interface InternalState extends ConfirmOptions {
  resolve: (value: boolean) => void;
  isAlert: boolean;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve, isAlert: false });
    });
  }, []);

  const alert = useCallback((options: Omit<ConfirmOptions, "cancelLabel">) => {
    return new Promise<void>((resolve) => {
      setState({
        ...options,
        resolve: () => resolve(),
        isAlert: true,
      });
    });
  }, []);

  const close = useCallback(
    (value: boolean) => {
      if (state) {
        state.resolve(value);
        setState(null);
      }
    },
    [state]
  );

  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      {state && (
        <Dialog
          ref={dialogRef}
          state={state}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

const Dialog = ({
  state,
  onCancel,
  onConfirm,
}: {
  ref?: React.Ref<HTMLDivElement>;
  state: InternalState;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useTranslation("common");
  const tone = state.tone ?? "default";

  const toneStyles: Record<ConfirmTone, { ring: string; btn: string; iconBg: string; iconColor: string; Icon: typeof Info }> = {
    default: {
      ring: "ring-primary/20",
      btn: "bg-primary text-primary-foreground hover:bg-primary/90",
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      Icon: Info,
    },
    warning: {
      ring: "ring-amber-200",
      btn: "bg-amber-500 text-white hover:bg-amber-600",
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
      Icon: AlertTriangle,
    },
    danger: {
      ring: "ring-red-200",
      btn: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      iconBg: "bg-red-50",
      iconColor: "text-red-600",
      Icon: AlertTriangle,
    },
  };
  const s = toneStyles[tone];
  const Icon = s.Icon;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !state.isAlert) onCancel();
      }}
    >
      <div
        tabIndex={-1}
        className={`relative w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl ring-4 ${s.ring} p-6 animate-in zoom-in-95 duration-150`}
      >
        <button
          onClick={() => (state.isAlert ? onConfirm() : onCancel())}
          aria-label={t("actions.close")}
          className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${s.iconBg}`}>
            <Icon className={`w-5 h-5 ${s.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h2 id="confirm-title" className="font-semibold text-base leading-snug">
              {state.title}
            </h2>
            {state.description && (
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-line">
                {state.description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          {!state.isAlert && (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
            >
              {state.cancelLabel ?? t("actions.cancel")}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${s.btn}`}
            autoFocus
          >
            {state.confirmLabel ?? t("actions.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx)
    throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx;
}
