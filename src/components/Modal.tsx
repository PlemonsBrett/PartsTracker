import { type ReactNode, useEffect } from 'react';

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet on phones, centred dialog on larger screens. Closes on Escape or backdrop tap. */
export default function Modal({ label, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal">
      <button type="button" className="backdrop" aria-label="Close dialog" tabIndex={-1} onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
