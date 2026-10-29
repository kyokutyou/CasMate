import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { InitialSetupConfirmation } from '../../src/renderer/components/InitialSetup';
import { InitialSetupEntry } from '../../src/renderer/components/InitialSetupEntry';
import { SmartphonePanel } from '../../src/renderer/components/SmartphonePanel';
import { ManagementNavigation, SetupPresentation } from '../../src/renderer/management-navigation';
import { managementThemeStyle } from '../../src/renderer/management-themes';
import { managementTextSizeStyle } from '../../src/renderer/management-text-sizes';
import type { ManagementThemeId } from '../../src/shared/management-theme';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import { setupStepIds } from '../../src/shared/initial-setup';
import type { AppSnapshot } from '../../src/shared/types';
import '../../src/renderer/styles.css';

const snapshot = JSON.parse(document.getElementById('fixture-data')!.textContent!) as AppSnapshot;
const base = snapshot.initialSetup!;
const root = createRoot(document.getElementById('root')!);
const noop = () => undefined;

function render(theme: ManagementThemeId, size: ManagementTextSizeId, checked: boolean, pending: boolean) {
  const view = { ...base, selected: checked ? base.selected : base.selected.filter(id => id === 'smartphone'), smartphoneUses: checked ? [...base.smartphoneUses] : [], confirmations: checked ? { ...base.fingerprints } : {} };
  flushSync(() => root.render(<div className="management-shell management-initial-setup" style={{ ...managementThemeStyle(theme), ...managementTextSizeStyle(size), display: 'block', height: 'auto', overflow: 'visible', padding: 20 }}>
    <div className="initial-setup"><InitialSetupEntry view={{ ...view, position: 'features' }} snapshot={snapshot} pending={pending} perform={async () => true} currentStatus={() => ''} /></div>
    <div className="setup-workspace" style={{ display: 'block' }}>
      {setupStepIds.map(step => <section key={step} className="setup-step-card" style={{ marginTop: 12 }}><InitialSetupConfirmation view={{ ...view, position: step }} snapshot={snapshot} pending={pending} blocked={false} settingsPending={() => false} command={async () => undefined} perform={async () => true} leave={noop} open={noop} onObsSource={noop} /></section>)}
      <ManagementNavigation.Provider value={{ editor: 'smartphone', initialSetup: true, setupPosition: 'smartphone', open: noop, reportError: noop }}>
        <SetupPresentation.Provider value={{ source: 'youtube', selectSource: noop, smartphoneUses: view.smartphoneUses, selectionPending: pending }}>
          <SmartphonePanel view={snapshot.smartphone!} mobile={snapshot.mobileSpeech} audioSettings={snapshot.settings.mobileSpeech} changeAudio={noop} configure={async () => undefined} deviceAction={async () => undefined} invitation={async () => { throw Error('Not used'); }} obsInput={async () => ''} onSuccess={noop} />
        </SetupPresentation.Provider>
      </ManagementNavigation.Provider>
    </div>
  </div>));
  document.querySelectorAll<HTMLDetailsElement>('.setup-phone-use-editor').forEach(node => { node.open = true; });
}

function measure() {
  return [...document.querySelectorAll<HTMLElement>('.setup-check-box, .setup-feature input, .setup-phone-uses input')].map(box => {
    const parent = box.parentElement!;
    const text = box.classList.contains('setup-check-box') ? box.nextElementSibling! : box.nextElementSibling ?? parent;
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (!node.textContent?.trim() || node.parentElement?.closest('input'))) node = walker.nextNode();
    if (!node) throw Error('Missing checkbox label');
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 1);
    const r = box.getBoundingClientRect(), label = range.getBoundingClientRect();
    const mark = document.createRange(); mark.selectNodeContents(box);
    const tick = box.textContent ? mark.getBoundingClientRect() : null;
    return { name: parent.textContent?.trim().slice(0, 45), custom: box.classList.contains('setup-check-box'), width: r.width, height: r.height,
      labelOffset: (r.top + r.bottom - label.top - label.bottom) / 2,
      tickOffset: tick ? (tick.top + tick.bottom - r.top - r.bottom) / 2 : 0,
      tickHorizontalOffset: tick ? (tick.left + tick.right - r.left - r.right) / 2 : 0 };
  });
}

function misaligned() {
  const items = measure();
  if (items.length !== 23) throw Error(`Expected 23 checkboxes, received ${items.length}`);
  return items.filter(item => Math.abs(item.labelOffset) > 2 || Math.abs(item.tickOffset) > 2 || Math.abs(item.tickHorizontalOffset) > 1 || item.width !== (item.custom ? 20 : 18) || item.height !== (item.custom ? 20 : 18));
}

window.checkboxHarness = { render, measure, misaligned };
declare global { interface Window { checkboxHarness: { render: typeof render; measure: typeof measure; misaligned: typeof misaligned }; } }
render('ocean', 'medium', true, false);
