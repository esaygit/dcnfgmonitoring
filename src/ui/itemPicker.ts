import { $ } from "../dom";
import { GROUP_PREFIX, ITEM_GROUPS } from "../constants";

/** Fills the hidden <select> that holds the item filter value. */
export function fillItems(select: HTMLSelectElement, showCode = true) {
  select.innerHTML = "";
  select.append(new Option("All items", ""));
  for (const { group, items } of ITEM_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group;
    optgroup.append(new Option(`All ${group}`, GROUP_PREFIX + group));
    for (const [code, name] of items) optgroup.append(new Option(showCode ? `${name} — ${code}` : name, code));
    select.append(optgroup);
  }
}

/** Custom item dropdown so the PPM group headings are clickable (the <select> stays as the hidden source of truth). */
export function buildItemPicker(itemFilter: HTMLSelectElement) {
  const host = $<HTMLElement>("#item-picker");
  type Choice = { value: string; label: string; hint: string; kind: "all" | "group" | "item" };
  const choices: Choice[] = [{ value: "", label: "All items", hint: "", kind: "all" }];
  for (const { group, items } of ITEM_GROUPS) {
    choices.push({ value: GROUP_PREFIX + group, label: group, hint: `All ${items.length} items`, kind: "group" });
    for (const [code, name] of items) choices.push({ value: code, label: name, hint: code, kind: "item" });
  }
  const button = document.createElement("button"), buttonLabel = document.createElement("span"), caret = document.createElement("span"), menu = document.createElement("div");
  button.type = "button"; button.className = "item-picker-button"; button.setAttribute("aria-haspopup", "listbox"); button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-labelledby", "item-picker-label");
  buttonLabel.className = "item-picker-label"; caret.className = "item-picker-caret"; caret.setAttribute("aria-hidden", "true"); button.append(buttonLabel, caret);
  menu.className = "item-picker-menu hidden"; menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", "Item filter");
  const open = () => { menu.classList.remove("hidden"); button.setAttribute("aria-expanded", "true"); (options.find((option) => option.getAttribute("aria-selected") === "true") ?? options[0]).focus(); };
  const close = (refocus = false) => { menu.classList.add("hidden"); button.setAttribute("aria-expanded", "false"); if (refocus) button.focus(); };
  const options = choices.map((choice) => {
    const option = document.createElement("button"), text = document.createElement("span");
    option.type = "button"; option.className = `item-choice item-choice-${choice.kind}`; option.setAttribute("role", "option"); option.dataset.value = choice.value;
    text.textContent = choice.label; option.append(text);
    if (choice.hint) { const hint = document.createElement("small"); hint.textContent = choice.hint; option.append(hint); }
    option.addEventListener("click", () => { itemFilter.value = choice.value; itemFilter.dispatchEvent(new Event("change")); close(true); });
    menu.append(option);
    return option;
  });
  const sync = () => {
    const current = choices.find((choice) => choice.value === itemFilter.value) ?? choices[0];
    buttonLabel.textContent = current.kind === "group" ? `${current.label} — all items` : current.label;
    options.forEach((option) => option.setAttribute("aria-selected", String(option.dataset.value === current.value)));
  };
  button.addEventListener("click", () => menu.classList.contains("hidden") ? open() : close());
  button.addEventListener("keydown", (event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (menu.classList.contains("hidden")) open(); } });
  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "ArrowDown") { event.preventDefault(); options[Math.min(options.length - 1, index + 1)].focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); options[Math.max(0, index - 1)].focus(); }
    else if (event.key === "Home") { event.preventDefault(); options[0].focus(); }
    else if (event.key === "End") { event.preventDefault(); options[options.length - 1].focus(); }
    else if (event.key === "Tab") close();
  });
  document.addEventListener("click", (event) => { if (!host.contains(event.target as Node)) close(); });
  host.append(button, menu);
  sync();
  return sync;
}
