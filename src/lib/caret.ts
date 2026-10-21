// The styles that change where text wraps in a textarea. The mirror element copies them.
const copied = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textIndent',
  'tabSize',
  'wordSpacing',
] as const;

/**
 * The position of a character in a textarea, relative to the top left corner of the textarea.
 * A hidden copy of the textarea with the same styles gives the position.
 */
export function caretCoordinates(element: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(element);
  const mirror = document.createElement('div');
  for (const name of copied) mirror.style[name] = style[name];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.textContent = element.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = element.value.slice(index) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
  const result = {
    top: marker.offsetTop - element.scrollTop,
    left: marker.offsetLeft - element.scrollLeft,
    height: lineHeight,
  };
  mirror.remove();
  return result;
}
