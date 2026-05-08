export type Lang = "en" | "tr";

export const translations = {
  en: {
    // Sidebar
    nav_dashboard: "Dashboard",
    nav_profile: "Profile",
    nav_clubs: "Clubs",
    nav_events: "Events",
    nav_projects: "Projects",
    nav_chats: "Chats",
    nav_notifications: "Notifications",

    // Navbar / search
    search_placeholder: "Search students, clubs, projects...",
    admin_badge: "Admin",
    sign_out: "Sign out",
    notifications: "Notifications",
    mark_all: "Mark all",
    you_are_caught_up: "You are all caught up!",
    view_all_notifications: "View all notifications",

    // User menu
    menu_profile: "Profile",
    menu_dark_mode: "Dark mode",
    menu_light_mode: "Light mode",
    menu_language: "Language",
    menu_logout: "Sign out",
    lang_english: "English",
    lang_turkish: "Türkçe",

    // Common
    loading: "Loading...",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    confirm: "Confirm",
  },
  tr: {
    // Sidebar
    nav_dashboard: "Anasayfa",
    nav_profile: "Profil",
    nav_clubs: "Kulüpler",
    nav_events: "Etkinlikler",
    nav_projects: "Projeler",
    nav_chats: "Sohbetler",
    nav_notifications: "Bildirimler",

    // Navbar / search
    search_placeholder: "Öğrenci, kulüp, proje ara...",
    admin_badge: "Yönetici",
    sign_out: "Çıkış",
    notifications: "Bildirimler",
    mark_all: "Tümünü oku",
    you_are_caught_up: "Hepsini gördün!",
    view_all_notifications: "Tüm bildirimleri gör",

    // User menu
    menu_profile: "Profil",
    menu_dark_mode: "Karanlık mod",
    menu_light_mode: "Aydınlık mod",
    menu_language: "Dil",
    menu_logout: "Çıkış yap",
    lang_english: "English",
    lang_turkish: "Türkçe",

    // Common
    loading: "Yükleniyor...",
    cancel: "İptal",
    save: "Kaydet",
    delete: "Sil",
    confirm: "Onayla",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;
