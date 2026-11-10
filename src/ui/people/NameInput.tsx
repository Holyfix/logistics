import { useState } from 'react';

/** Pole pro název (jméno, činnost …), které se potvrdí po opuštění nebo Enteru; nepřijatý název ukáže chybu. */
export function NameInput({ value, label, invalid, commit }: { value: string; label: string; invalid: string; commit: (value: string) => boolean }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const done = () => {
    if (text.trim() === value) {
      setText(value);
      setBad(false);
      return;
    }
    const ok = commit(text);
    setBad(!ok);
  };
  return (
    <span className="name-input">
      <input
        aria-label={label}
        value={text}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done();
        }}
      />
      {bad && <small className="cell-short">{invalid}</small>}
    </span>
  );
}

/** Řádek pro přidání položky: pole a tlačítko Přidat (Enter také přidá). Nepřijatý název ukáže chybu. */
export function AddRow({ placeholder, button, invalid, add }: { placeholder: string; button: string; invalid: string; add: (name: string) => boolean }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const submit = () => {
    if (add(text)) {
      setText('');
      setBad(false);
    } else setBad(true);
  };
  return (
    <span className="add-row">
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button type="button" className="button button-small" onClick={submit}>
        + {button}
      </button>
      {bad && <small className="cell-short">{invalid}</small>}
    </span>
  );
}
