import { ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { Lang, SUPPORTED_LANGS, isRTL } from "../lib/i18n";

function normalize(lng: string): Lang {
  const base = (lng || "en").toLowerCase().split("-")[0];
  return (SUPPORTED_LANGS as readonly string[]).includes(base)
    ? (base as Lang)
    : "en";
}

function applyHtmlAttrs(lng: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lng;
  document.documentElement.dir = isRTL(lng) ? "rtl" : "ltr";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyHtmlAttrs(i18n.language);
    const onChange = (lng: string) => applyHtmlAttrs(lng);
    i18n.on("languageChanged", onChange);
    return () => {
      i18n.off("languageChanged", onChange);
    };
  }, []);

  return <>{children}</>;
}

export function useLanguage() {
  const { t, i18n: instance } = useTranslation();
  const [lang, setLangState] = useState<Lang>(normalize(instance.language));

  useEffect(() => {
    const onChange = (lng: string) => setLangState(normalize(lng));
    instance.on("languageChanged", onChange);
    return () => {
      instance.off("languageChanged", onChange);
    };
  }, [instance]);

  return {
    lang,
    setLang: (l: Lang) => instance.changeLanguage(l),
    t,
    dir: (isRTL(lang) ? "rtl" : "ltr") as "ltr" | "rtl",
    isRTL: isRTL(lang),
  };
}
