import type { Session } from "@supabase/supabase-js";
import "./style.css";
import "./polish.css";
import { supabase } from "./api";
import { $ } from "./dom";
import { debounce } from "./utils";
import { message } from "./ui/toast";
import { initTheme } from "./ui/theme";
import { closeDrawer, initDrawer } from "./ui/drawer";
import { initRecords, loadRecords } from "./ui/records";
import { loadOverview } from "./ui/overview";
import { initAnalytics, loadAnalytics } from "./ui/analytics";
import { initImport } from "./ui/importPage";

const authSection = $<HTMLElement>("#auth-section"), dashboard = $<HTMLElement>("#dashboard-section"), userPanel = $<HTMLElement>("#user-panel"), userEmail = $<HTMLElement>("#user-email");
const authForm = $<HTMLFormElement>("#auth-form"), email = $<HTMLInputElement>("#email-input"), password = $<HTMLInputElement>("#password-input"), signIn = $<HTMLButtonElement>("#sign-in-button"), signOut = $<HTMLButtonElement>("#sign-out-button");

// ---- Data ----
async function refreshAll() {
  await Promise.allSettled([loadRecords(), loadOverview(), loadAnalytics()]);
}
// Several rows inserted at once fire several realtime events; refresh only once.
const scheduleRefresh = debounce(() => void refreshAll(), 500);

// ---- Routing ----
const PAGES = ["overview", "analytics", "import", "records"];
function route() {
  const hash = location.hash.replace(/^#\//, ""), name = hash === "export" ? "records" : hash, current = PAGES.includes(name) ? name : "overview"; // #/export (old bookmarks) now opens Records
  document.querySelectorAll<HTMLElement>(".page").forEach((page) => page.classList.toggle("hidden", page.dataset.page !== current));
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((link) => {
    const on = link.dataset.nav === current;
    link.classList.toggle("active", on);
    if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  closeDrawer();
  window.scrollTo(0, 0);
}

// ---- Session ----
let signedInUser: string | undefined;
function showSession(next: Session | null) {
  const signedIn = Boolean(next);
  authSection.classList.toggle("hidden", signedIn);
  dashboard.classList.toggle("hidden", !signedIn);
  userPanel.classList.toggle("hidden", !signedIn);
  userEmail.textContent = next?.user.email ?? "";
  const userId = next?.user.id;
  if (userId !== signedInUser) { // token refreshes also fire auth events; only reload when the user actually changes
    signedInUser = userId;
    if (userId) void refreshAll();
  }
  if (signedIn) route();
}

// ---- Setup ----
initTheme();
initDrawer();
initRecords();
initAnalytics();
initImport(refreshAll);

if (!supabase) {
  message("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to GitHub Actions secrets.", "error");
  signIn.disabled = true;
} else {
  supabase.auth.onAuthStateChange((_event, next) => showSession(next));
  supabase.auth.getSession().then(({ data }) => showSession(data.session));
  supabase.channel("transfers-live").on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, scheduleRefresh).subscribe();
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  signIn.disabled = true;
  message("Signing in…", "", 0);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value });
    message(error ? error.message : "", error ? "error" : "");
  } catch (error) {
    message(error instanceof Error ? error.message : "Could not sign in. Please try again.", "error");
  } finally {
    signIn.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  if (!supabase) return;
  signOut.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) { message(`Could not sign out: ${error.message}`, "error"); return; }
    showSession(null);
    message("Signed out successfully.", "success");
  } catch (error) {
    message(error instanceof Error ? `Could not sign out: ${error.message}` : "Could not sign out. Please try again.", "error");
  } finally {
    signOut.disabled = false;
  }
});

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null;
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (link.target && link.target !== "_self")) return;
  event.preventDefault();
  if (location.hash !== link.hash) history.pushState(null, "", link.hash);
  route();
}, true);
window.addEventListener("popstate", route);
window.addEventListener("hashchange", route);
route();
