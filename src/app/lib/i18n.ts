import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "../i18n/locales/en/common.json";
import enAuth from "../i18n/locales/en/auth.json";
import enDashboard from "../i18n/locales/en/dashboard.json";
import enProjects from "../i18n/locales/en/projects.json";
import enChat from "../i18n/locales/en/chat.json";
import enClubs from "../i18n/locales/en/clubs.json";
import enSettings from "../i18n/locales/en/settings.json";
import enErrors from "../i18n/locales/en/errors.json";
import enProfile from "../i18n/locales/en/profile.json";
import enEvents from "../i18n/locales/en/events.json";
import enWorkspace from "../i18n/locales/en/workspace.json";

import trCommon from "../i18n/locales/tr/common.json";
import trAuth from "../i18n/locales/tr/auth.json";
import trDashboard from "../i18n/locales/tr/dashboard.json";
import trProjects from "../i18n/locales/tr/projects.json";
import trChat from "../i18n/locales/tr/chat.json";
import trClubs from "../i18n/locales/tr/clubs.json";
import trSettings from "../i18n/locales/tr/settings.json";
import trErrors from "../i18n/locales/tr/errors.json";
import trProfile from "../i18n/locales/tr/profile.json";
import trEvents from "../i18n/locales/tr/events.json";
import trWorkspace from "../i18n/locales/tr/workspace.json";

import ruCommon from "../i18n/locales/ru/common.json";
import ruAuth from "../i18n/locales/ru/auth.json";
import ruDashboard from "../i18n/locales/ru/dashboard.json";
import ruProjects from "../i18n/locales/ru/projects.json";
import ruChat from "../i18n/locales/ru/chat.json";
import ruClubs from "../i18n/locales/ru/clubs.json";
import ruSettings from "../i18n/locales/ru/settings.json";
import ruErrors from "../i18n/locales/ru/errors.json";
import ruProfile from "../i18n/locales/ru/profile.json";
import ruEvents from "../i18n/locales/ru/events.json";
import ruWorkspace from "../i18n/locales/ru/workspace.json";

import arCommon from "../i18n/locales/ar/common.json";
import arAuth from "../i18n/locales/ar/auth.json";
import arDashboard from "../i18n/locales/ar/dashboard.json";
import arProjects from "../i18n/locales/ar/projects.json";
import arChat from "../i18n/locales/ar/chat.json";
import arClubs from "../i18n/locales/ar/clubs.json";
import arSettings from "../i18n/locales/ar/settings.json";
import arErrors from "../i18n/locales/ar/errors.json";
import arProfile from "../i18n/locales/ar/profile.json";
import arEvents from "../i18n/locales/ar/events.json";
import arWorkspace from "../i18n/locales/ar/workspace.json";

export const SUPPORTED_LANGS = ["en", "tr", "ru", "ar"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const RTL_LANGS: Lang[] = ["ar"];

export const NAMESPACES = [
  "common",
  "auth",
  "dashboard",
  "projects",
  "chat",
  "clubs",
  "settings",
  "errors",
  "profile",
  "events",
  "workspace",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const LANG_STORAGE_KEY = "campusconnect_lang";

export function isRTL(lang: string): boolean {
  return RTL_LANGS.includes(lang.split("-")[0] as Lang);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        dashboard: enDashboard,
        projects: enProjects,
        chat: enChat,
        clubs: enClubs,
        settings: enSettings,
        errors: enErrors,
        profile: enProfile,
        events: enEvents,
        workspace: enWorkspace,
      },
      tr: {
        common: trCommon,
        auth: trAuth,
        dashboard: trDashboard,
        projects: trProjects,
        chat: trChat,
        clubs: trClubs,
        settings: trSettings,
        errors: trErrors,
        profile: trProfile,
        events: trEvents,
        workspace: trWorkspace,
      },
      ru: {
        common: ruCommon,
        auth: ruAuth,
        dashboard: ruDashboard,
        projects: ruProjects,
        chat: ruChat,
        clubs: ruClubs,
        settings: ruSettings,
        errors: ruErrors,
        profile: ruProfile,
        events: ruEvents,
        workspace: ruWorkspace,
      },
      ar: {
        common: arCommon,
        auth: arAuth,
        dashboard: arDashboard,
        projects: arProjects,
        chat: arChat,
        clubs: arClubs,
        settings: arSettings,
        errors: arErrors,
        profile: arProfile,
        events: arEvents,
        workspace: arWorkspace,
      },
    },
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    fallbackLng: "en",
    defaultNS: "common",
    ns: NAMESPACES as unknown as string[],
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

export default i18n;
