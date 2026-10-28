export const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

export function emptyRow(body: HTMLTableSectionElement, columns: number, text: string) {
  const tr = document.createElement("tr"), td = document.createElement("td");
  td.colSpan = columns; td.className = "empty"; td.textContent = text;
  tr.append(td); body.append(tr);
}
