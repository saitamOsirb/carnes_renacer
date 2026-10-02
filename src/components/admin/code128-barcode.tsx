type Props = {
  value: string;
  className?: string;
};

const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
] as const;

function encodeCode128B(value: string): string[] | null {
  const codes = [104];
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code > 126) return null;
    codes.push(code - 32);
  }

  let checksum = 104;
  for (let index = 1; index < codes.length; index += 1) checksum += codes[index] * index;
  codes.push(checksum % 103, 106);
  return codes.map((code) => CODE128_PATTERNS[code]);
}

export function Code128Barcode({ value, className }: Props) {
  const patterns = encodeCode128B(value);
  if (!patterns) return <span className={className}>Código no compatible</span>;

  const quiet = 10;
  const modules = patterns.reduce((sum, pattern) => sum + [...pattern].reduce((inner, digit) => inner + Number(digit), 0), 0);
  const totalWidth = modules + quiet * 2;
  const bars: Array<{ x: number; width: number }> = [];
  let cursor = quiet;

  for (const pattern of patterns) {
    let isBar = true;
    for (const digit of pattern) {
      const width = Number(digit);
      if (isBar) bars.push({ x: cursor, width });
      cursor += width;
      isBar = !isBar;
    }
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${totalWidth} 60`}
      role="img"
      aria-label={`Código de barras ${value}`}
      preserveAspectRatio="none"
    >
      <rect width={totalWidth} height="60" fill="#fff" />
      {bars.map((bar, index) => <rect key={`${bar.x}-${index}`} x={bar.x} y="0" width={bar.width} height="60" fill="#000" />)}
    </svg>
  );
}
