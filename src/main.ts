import { createClient, type Session } from "@supabase/supabase-js";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const supabase = url && key ? createClient(url, key) : null;
const HEADERS = ["Transaction Reference", "Document Date", "Transferred From", "Transferred To", "Item Code", "Description", "Product Code", "Batch Code", "Quantity", "Pallets"] as const;
type Header = (typeof HEADERS)[number];
type ImportRow = Record<Header, string>;
type Transfer = { id: string; transaction_reference: string; document_date: string; transferred_from: string; transferred_to: string; item_code: string; description: string; product_code: string | null; batch_code: string | null; quantity: number; pallets: string[]; source_filename: string | null; created_at: string };

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const status = $<HTMLParagraphElement>("#status"), authSection = $<HTMLElement>("#auth-section"), dashboard = $<HTMLElement>("#dashboard-section"), userPanel = $<HTMLElement>("#user-panel"), userEmail = $<HTMLElement>("#user-email");
const authForm = $<HTMLFormElement>("#auth-form"), email = $<HTMLInputElement>("#email-input"), password = $<HTMLInputElement>("#password-input"), signIn = $<HTMLButtonElement>("#sign-in-button"), signUp = $<HTMLButtonElement>("#sign-up-button"), signOut = $<HTMLButtonElement>("#sign-out-button");
const pdf = $<HTMLInputElement>("#pdf-file"), pdfName = $<HTMLElement>("#pdf-name"), extract = $<HTMLButtonElement>("#extract-button"), review = $<HTMLElement>("#review-section"), reviewHead = $<HTMLTableSectionElement>("#review-table thead"), reviewBody = $<HTMLTableSectionElement>("#review-table tbody"), addRow = $<HTMLButtonElement>("#add-row-button"), save = $<HTMLButtonElement>("#save-button"), reset = $<HTMLButtonElement>("#reset-button");
const refresh = $<HTMLButtonElement>("#refresh-button"), search = $<HTMLInputElement>("#search-input"), recordsHead = $<HTMLTableSectionElement>("#records-table thead"), recordsBody = $<HTMLTableSectionElement>("#records-table tbody"), recordsDescription = $<HTMLElement>("#records-description");

let rows: ImportRow[] = [], transfers: Transfer[] = [], session: Session | null = null;
function message(text = "", kind: "" | "error" | "success" = "") { status.textContent = text; status.className = `status ${kind}`; }
function clean(value: string | undefined) { return (value ?? "").replace(/\s+/g, " ").trim(); }
function matched(text: string, pattern: RegExp) { return clean(text.match(pattern)?.[1]); }
function isoDate(value: string) { const match = value.match(/^(\d{2})-(\d{2})-(\d{2}|\d{4})$/); return match ? `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[2]}-${match[1]}` : ""; }
function displayDate(value: string) { const [year, month, day] = value.split("-"); return year ? `${day}-${month}-${year}` : ""; }

async function pdfText(file: File) {
  const document = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let page = 1; page <= document.numPages; page++) {
    const content = await (await document.getPage(page)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return pages.join("\n");
}
function pallets(filename: string) { const part = filename.replace(/\.pdf$/i, "").match(/\bPALLETS?\s+(.+?)(?=\s+\d{8}\b|$)/i)?.[1] ?? ""; return (part.match(/\b\d{3,6}\b/g) ?? []).join(", "); }
function parse(text: string, filename: string): ImportRow[] {
  const base = { "Transaction Reference": matched(text, /\b(GAA\s*\d{4,})\b/i).replace(/\s+/g, ""), "Document Date": matched(text, /DOCUMENT\s+DATE\s*:\s*(\d{2}-\d{2}-\d{2})/i), "Transferred From": matched(text, /SHIP\s+FROM\s*:\s*(W\d+)/i), "Transferred To": matched(text, /SHIP\s+TO\s*:\s*(W\d+)/i), "Pallets": pallets(filename) };
  const items = [...text.matchAll(/(?:^|\s)(\d{8,})\s*(.*?)\s+([A-Z0-9-]+)LOC\s+([A-Z0-9-]+)\s+([\d,]+(?:\.\d+)?)(?=\s+)/gi)];
  if (!items.length) return [{ ...base, "Item Code": "", "Description": "", "Product Code": "", "Batch Code": "", "Quantity": "" }];
  return items.map((item) => ({ ...base, "Item Code": clean(item[1]), "Description": clean(item[2]), "Product Code": clean(item[3]), "Batch Code": clean(item[4]), "Quantity": clean(item[5]) }));
}
function renderRows() {
  reviewHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}<th></th></tr>`; reviewBody.innerHTML = "";
  rows.forEach((row, index) => { const tr = document.createElement("tr"); HEADERS.forEach((header) => { const td = document.createElement("td"), input = document.createElement("input"); input.value = row[header]; input.setAttribute("aria-label", `${header}, row ${index + 1}`); input.addEventListener("input", () => { rows[index][header] = input.value; }); td.append(input); tr.append(td); }); const td = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-row"; remove.textContent = "Remove"; remove.addEventListener("click", () => { rows.splice(index, 1); renderRows(); }); td.append(remove); tr.append(td); reviewBody.append(tr); });
}
function renderTransfers() {
  const query = search.value.trim().toLowerCase(); const shown = transfers.filter((transfer) => !query || [transfer.transaction_reference, transfer.item_code, transfer.description, transfer.batch_code, transfer.transferred_from, transfer.transferred_to].some((value) => value?.toLowerCase().includes(query)));
  const quantity = transfers.reduce((total, transfer) => total + Number(transfer.quantity || 0), 0);
  $<HTMLElement>("#total-records").textContent = String(transfers.length); $<HTMLElement>("#total-quantity").textContent = quantity.toLocaleString(); $<HTMLElement>("#total-references").textContent = String(new Set(transfers.map((transfer) => transfer.transaction_reference)).size); $<HTMLElement>("#total-destinations").textContent = String(new Set(transfers.map((transfer) => transfer.transferred_to)).size);
  recordsDescription.textContent = `${shown.length} of ${transfers.length} records`; recordsHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}<th></th></tr>`; recordsBody.innerHTML = "";
  shown.forEach((transfer) => { const tr = document.createElement("tr"); [transfer.transaction_reference, displayDate(transfer.document_date), transfer.transferred_from, transfer.transferred_to, transfer.item_code, transfer.description, transfer.product_code ?? "", transfer.batch_code ?? "", String(transfer.quantity), transfer.pallets.join(", ")].forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.append(td); }); const td = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-row"; remove.textContent = "Delete"; remove.addEventListener("click", () => void deleteTransfer(transfer.id)); td.append(remove); tr.append(td); recordsBody.append(tr); });
}
async function loadTransfers() { if (!supabase || !session) return; recordsDescription.textContent = "Loading records…"; const { data, error } = await supabase.from("transfers").select("*").order("document_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000); if (error) { message(`Could not load records: ${error.message}`, "error"); return; } transfers = (data ?? []) as Transfer[]; renderTransfers(); }
async function deleteTransfer(id: string) { if (!supabase || !confirm("Delete this transfer record?")) return; const { error } = await supabase.from("transfers").delete().eq("id", id); if (error) message(`Could not delete record: ${error.message}`, "error"); }
async function saveRows() {
  const file = pdf.files?.[0]; if (!supabase || !file || !rows.length) return;
  const data = rows.map((row) => ({ transaction_reference: clean(row["Transaction Reference"]), document_date: isoDate(clean(row["Document Date"])), transferred_from: clean(row["Transferred From"]), transferred_to: clean(row["Transferred To"]), item_code: clean(row["Item Code"]), description: clean(row.Description), product_code: clean(row["Product Code"]) || null, batch_code: clean(row["Batch Code"]) || null, quantity: Number(row.Quantity.replace(/,/g, "")), pallets: clean(row.Pallets).split(",").map((value) => value.trim()).filter(Boolean), source_filename: file.name }));
  if (data.some((row) => !row.transaction_reference || !row.document_date || !row.transferred_from || !row.transferred_to || !row.item_code || !row.description || !Number.isFinite(row.quantity))) { message("Complete all required fields and use a valid document date and quantity before saving.", "error"); return; }
  save.disabled = true; message("Saving records to the shared dashboard…"); const { error } = await supabase.from("transfers").insert(data); save.disabled = false; if (error) { message(`Could not save records: ${error.message}`, "error"); return; } message(`${data.length} record${data.length === 1 ? "" : "s"} saved to the shared dashboard.`, "success"); pdf.value = ""; pdfName.textContent = "No PDF selected"; rows = []; review.classList.add("hidden");
}
function showSession(next: Session | null) { session = next; const signedIn = Boolean(next); authSection.classList.toggle("hidden", signedIn); dashboard.classList.toggle("hidden", !signedIn); userPanel.classList.toggle("hidden", !signedIn); userEmail.textContent = next?.user.email ?? ""; if (signedIn) void loadTransfers(); }

if (!supabase) { message("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to GitHub Actions secrets.", "error"); signIn.disabled = true; signUp.disabled = true; } else {
  supabase.auth.onAuthStateChange((_event, next) => showSession(next)); supabase.auth.getSession().then(({ data }) => showSession(data.session)); supabase.channel("transfers-live").on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, () => void loadTransfers()).subscribe();
}
authForm.addEventListener("submit", async (event) => { event.preventDefault(); if (!supabase) return; signIn.disabled = true; message("Signing in…"); const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value }); signIn.disabled = false; if (error) message(error.message, "error"); });
signUp.addEventListener("click", async () => { if (!supabase || !email.reportValidity() || !password.reportValidity()) return; signUp.disabled = true; message("Creating account…"); const { error } = await supabase.auth.signUp({ email: email.value, password: password.value, options: { emailRedirectTo: window.location.href } }); signUp.disabled = false; message(error ? error.message : "Account created. Check your email to confirm it before signing in.", error ? "error" : "success"); });
signOut.addEventListener("click", async () => { if (supabase) await supabase.auth.signOut(); });
pdf.addEventListener("change", () => { pdfName.textContent = pdf.files?.[0]?.name ?? "No PDF selected"; extract.disabled = !pdf.files?.[0]; });
extract.addEventListener("click", async () => { const file = pdf.files?.[0]; if (!file) return; try { extract.disabled = true; message("Reading IWTS PDF…"); rows = parse(await pdfText(file), file.name); renderRows(); review.classList.remove("hidden"); message("Extraction complete. Review the records before saving.", "success"); } catch (error) { message(error instanceof Error ? error.message : "Could not process this PDF.", "error"); } finally { extract.disabled = false; } });
addRow.addEventListener("click", () => { rows.push(Object.fromEntries(HEADERS.map((header) => [header, ""])) as ImportRow); renderRows(); }); save.addEventListener("click", () => void saveRows()); reset.addEventListener("click", () => { rows = []; review.classList.add("hidden"); message("Import discarded."); }); refresh.addEventListener("click", () => void loadTransfers()); search.addEventListener("input", renderTransfers);
