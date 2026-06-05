import React from 'react';
import { useStore } from '../../store';
import { sendCommand } from '../../ws';

export default function PickerButton(): React.ReactElement {
  const pickerActive = useStore((s) => s.pickerActive);
  const pickerPending = useStore((s) => s.pickerPending);
  const pickerError = useStore((s) => s.pickerError);
  const setPickerActive = useStore((s) => s.setPickerActive);
  const setPickerPending = useStore((s) => s.setPickerPending);
  const setPickerError = useStore((s) => s.setPickerError);
  const handleClick = async () => {
    if (pickerPending) return;

    setPickerError(null);
    setPickerPending(true);

    try {
      if (pickerActive) {
        const reply = await sendCommand('elements.stopPicker', {});
        if (reply.error) {
       setPickerError(reply.error);
        } else {
      setPickerActive(false);
        }
      } else {
        const reply = await sendCommand('elements.startPicker', {});
        if (reply.error) {
          setPickerError(reply.error);
        } else {
          setPickerActive(true);
        }
      }
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Picker command failed');
    } finally {
      setPickerPending(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={handleClick}
      disabled={pickerPending}
        title={
          pickerPending
            ? 'Processing...'
            : pickerActive
            ? 'Stop picking element (Esc)'
            : 'Pick an element from the page'
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 8px',
          background: pickerActive ? 'var(--accent-blue)' : 'transparent',
          color: pickerActive ? 'white' : 'var(--text-secondary)',
        border: '1px solid var(--border)',
          borderRadius: 3,
          cursor: pickerPending ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: pickerActive ? 600 : 400,
          opacity: pickerPending ? 0.6 : 1,
        }}
      >
        <span style={{ fontSize: 14, marginRight: 4 }}>{pickerPending ? '⟳' : '⊕'}</span>
        {pickerPending ? 'Picking...' : 'Pick'}
      </button>
      {pickerError && (
        <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>
          ⚠ {pickerError}
     </span>
      )}
    </div>
  );
}
