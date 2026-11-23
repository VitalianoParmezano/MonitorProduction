// Допоміжники для полів штрихкоду (сканер надсилає Enter).

export function bindEnter(input, handler) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handler();
    }
  });
}

export function focusAndSelect(input) {
  if (!input) return;
  input.focus();
  input.select();
}
