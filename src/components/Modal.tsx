import { type FormEvent, type ReactNode, useEffect } from 'react';

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
