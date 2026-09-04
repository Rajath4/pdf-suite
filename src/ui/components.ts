/** Tiny DOM helpers — no framework, fully typed. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.append(c);
  }
  return node;
}

export function field(label: string, input: HTMLElement): HTMLElement {
  const wrap = el('label', { class: 'field' });
  wrap.append(el('span', { class: 'field-label' }, label));
  wrap.append(input);
  return wrap;
}

export function textInput(value: string, placeholder = '', type = 'text'): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.value = value;
  i.placeholder = placeholder;
  i.className = 'input';
  return i;
}

export function textArea(value: string, placeholder = '', rows = 6): HTMLTextAreaElement {
  const t = document.createElement('textarea');
  t.value = value;
  t.placeholder = placeholder;
  t.rows = rows;
  t.className = 'input mono';
  return t;
}

export function selectInput(options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = 'input';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    s.append(opt);
  }
  return s;
}

export function statusBox(): { box: HTMLElement; set: (msg: string, kind?: 'info' | 'error' | 'ok') => void } {
  const box = el('div', { class: 'status', role: 'status' }, 'Ready.');
  const set = (msg: string, kind: 'info' | 'error' | 'ok' = 'info') => {
    box.textContent = msg;
    box.dataset.kind = kind;
  };
  return { box, set };
}
