import React, { useState } from 'react';
import { sendCommand } from '../../ws';

export default function PickerButton(): React.ReactElement {
  const [active, setActive] = useState(false);

  const handleClick = async () => {
    if (active) {
   await sendCommand('elements.stopPicker', {});
      setActive(false);
    } else {
      await sendCommand('elements.startPicker', {});
      setActive(true);
    }
  };

  return (
    <button
      onClick={handleClick}
      title={active ? 'Stop picking element (Esc)' : 'Pick an element from the page'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 8px',
        background: active ? 'var(--accent-blue)' : 'transparent',
        color: active ? 'white' : 'var(--text-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
      }}
    >
      <span style={{ fontSize: 14, marginRight: 4 }}>⊕</span>
      Pick
    </button>
  );
}
