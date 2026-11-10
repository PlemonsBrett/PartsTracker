import Modal from './Modal';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'The parts list',
    keys: [
      ['/', 'Search'],
      ['↓ or J', 'Next part'],
      ['↑ or K', 'Previous part'],
      ['Enter', 'Open the selected part'],
      ['+ / −', 'Add or remove one'],
      ['Esc', 'Clear the selection or search'],
    ],
  },
  {
    title: 'Anywhere',
    keys: [
      ['C', 'Capture (type or dictate)'],
      ['N', 'Add a part by hand'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'In capture and update dialogs',
    keys: [
      ['Ctrl + Enter', 'Analyze, then Apply'],
      ['Esc', 'Close'],
    ],
  },
];

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {GROUPS.map((g) => (
        <section key={g.title} className="keys">
          <h3>{g.title}</h3>
          <dl>
            {g.keys.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="hint">Single keys work when you are not typing in a box. On a Mac, use Cmd instead of Ctrl.</p>
    </Modal>
  );
}
