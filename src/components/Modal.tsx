import { type FormEvent, type ReactNode, useEffect, useRef } from 'react';

// Open dialogs, oldest first. Escape closes only the newest, so a dialog opened from another closes alone.
const open: symbol[] = [];

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned below the scrolling body, so primary actions never scroll out of reach. */
  footer?: ReactNode;
  /** When set, the sheet is a <form> and the footer's submit button submits it. */
  onSubmit?: (e: FormEvent) => void;
}

/** Bottom sheet on phones, centred dialog on larger screens. Closes on Escape, ✕ or a backdrop tap. */
export default function Modal({ title, onClose, children, footer, onSubmit }: Props) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const me = Symbol('modal');
    open.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open[open.length - 1] === me) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      open.splice(open.indexOf(me), 1);
    };
  }, []);

  const inner = (
    <>
      <div className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="icon" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="sheet-body">{children}</div>
      {footer && <div className="sheet-foot">{footer}</div>}
    </>
  );

  return (
    <div className="modal">
      <button type="button" className="backdrop" aria-label="Close dialog" tabIndex={-1} onClick={onClose} />
      {onSubmit ? (
        <form className="sheet" role="dialog" aria-modal="true" aria-label={title} onSubmit={onSubmit}>
          {inner}
        </form>
      ) : (
        <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
          {inner}
        </div>
      )}
    </div>
  );
}
