// 표준 Gamepad API의 물리적 버튼 위치를 직접 그린 설정용 도식.
const BUTTONS = [
  [0, 407, 191, 'A / ✕'], [1, 443, 155, 'B / ○'], [2, 371, 155, 'X / □'], [3, 407, 119, 'Y / △'],
  [4, 131, 73, 'LB / L1', 'shoulder'], [5, 389, 73, 'RB / R1', 'shoulder'],
  [6, 131, 32, 'LT / L2', 'shoulder'], [7, 389, 32, 'RT / R2', 'shoulder'],
  [8, 225, 142, 'View', 'menu'], [9, 295, 142, 'Start', 'menu'],
  [10, 205, 223, 'L', 'stick'], [11, 315, 223, 'R', 'stick'],
  [12, 113, 121, '↑', 'direction'], [13, 113, 189, '↓', 'direction'],
  [14, 79, 155, '←', 'direction'], [15, 147, 155, '→', 'direction'], [16, 260, 103, '⌂', 'menu'],
];
export function gamepadDiagramMarkup(indices = []) {
  const active = new Set(indices);
  return `<svg class="gamepad-diagram" viewBox="0 0 520 300" aria-hidden="true" focusable="false">
    <path class="gamepad-shell" d="M145 66 C96 66 66 81 53 119 L19 236 C8 288 48 303 76 276 L136 228 Q260 256 384 228 L444 276 C472 303 512 288 501 236 L467 119 C454 81 424 66 375 66 Z"/>
    <path class="gamepad-grip" d="M67 213 L43 256 M453 213 L477 256"/>
    ${BUTTONS.map(([index, x, y, text, shape]) => {
      const wide = shape === 'shoulder', direction = shape === 'direction', width = wide ? 92 : direction ? 31 : 48;
      return `<g class="gamepad-diagram-button" data-button="${index}" data-assigned="${active.has(index)}" transform="translate(${x} ${y})">
        ${wide || direction ? `<rect x="${-width / 2}" y="-16" width="${width}" height="32" rx="${wide ? 12 : 6}"/>` : `<circle r="${shape === 'stick' ? 27 : shape === 'menu' ? 22 : 23}"/>`}
        <text text-anchor="middle" dominant-baseline="central">${text}</text>
        ${active.has(index) ? '<circle class="gamepad-assignment-dot" cx="18" cy="-19" r="6"/>' : ''}
      </g>`;
    }).join('')}
  </svg>`;
}
