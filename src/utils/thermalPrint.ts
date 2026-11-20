import { apiFetch } from '../services/api';

interface SerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable?: {
    getWriter: () => {
      write: (chunk: Uint8Array) => Promise<void>;
      releaseLock: () => void;
    };
  };
}

interface NavigatorWithSerial extends Navigator {
  serial?: {
    requestPort: () => Promise<SerialPortLike>;
  };
}

export interface ThermalPrintPayload {
  kind: 'RECEIPT' | 'KITCHEN';
  orderNumber: string;
  tableLabel?: string | null;
  customerName?: string;
  stationLabel?: string;
  notes?: string;
  paymentMethod?: string;
  paymentReference?: string;
  paidAmountXof?: number;
  totalXof?: number;
  items: Array<{
    name: string;
    quantity: number;
    lineTotalXof?: number;
    optionsSummary?: string;
    notes?: string;
  }>;
  sendNetwork?: boolean;
  printerHost?: string;
  printerPort?: number;
  logoRasterBase64?: string;
}

export interface ThermalPrintResponse {
  ok: boolean;
  mode: 'BROWSER' | 'NETWORK_ESCPOS' | 'WEB_SERIAL';
  paperWidth: '58mm' | '80mm';
  previewText: string;
  logoUrl?: string | null;
  base64Bytes: string;
  networkResult: { ok: boolean; bytesSent: number; error?: string } | null;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function supportsWebSerial(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean((navigator as NavigatorWithSerial).serial)
  );
}

export async function printViaWebSerial(bytes: Uint8Array): Promise<void> {
  const nav = navigator as NavigatorWithSerial;
  if (!nav.serial) {
    throw new Error('WebSerial non pris en charge par ce navigateur.');
  }
  const port = await nav.serial.requestPort();
  await port.open({ baudRate: 9600 });
  try {
    const writer = port.writable?.getWriter();
    if (!writer) {
      throw new Error('Port série non accessible en écriture.');
    }
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  } finally {
    await port.close().catch(() => {});
  }
}


async function buildLogoRasterBase64(
  logoUrl: string,
  paperWidth: '58mm' | '80mm',
): Promise<string | null> {
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = logoUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Logo image unavailable'));
    });
    const maxWidth = paperWidth === '58mm' ? 384 : 576;
    const maxHeight = 150;
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
    const width = Math.max(1, Math.floor(image.naturalWidth * scale));
    const height = Math.max(1, Math.floor(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const bytesPerRow = Math.ceil(width / 8);
    const raster: number[] = [
      0x1b, 0x40, 0x1b, 0x61, 0x01,
      0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff,
    ];
    for (let y = 0; y < height; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let value = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x >= width) continue;
          const offset = (y * width + x) * 4;
          const luminance = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
          if (luminance < 170 && pixels[offset + 3] > 32) value |= 0x80 >> bit;
        }
        raster.push(value);
      }
    }
    raster.push(0x0a);
    let binary = '';
    for (let i = 0; i < raster.length; i += 0x8000) {
      binary += String.fromCharCode(...raster.slice(i, i + 0x8000));
    }
    return window.btoa(binary);
  } catch {
    return null;
  }
}

function printThermalPreview(previewText: string, paperWidth: '58mm' | '80mm', logoUrl?: string | null) {
  const frame = document.createElement('iframe');
  frame.title = 'Ticket Resto’MAX';
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.onload = () => {
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 100);
  };
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error('Impossible de préparer le document à imprimer.');
  const style = doc.createElement('style');
  style.textContent = '@page { size: ' + paperWidth + ' auto; margin: 2mm; } body { margin: 0; width: ' + paperWidth + '; color: #000; background: #fff; } pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 11pt/1.35 monospace; }';
  const pre = doc.createElement('pre');
  pre.textContent = previewText;
  doc.head.appendChild(style);
  if (logoUrl) {
    const logo = doc.createElement('img');
    logo.src = logoUrl;
    logo.alt = 'Logo du restaurant';
    logo.style.display = 'block';
    logo.style.maxWidth = '55%';
    logo.style.maxHeight = '22mm';
    logo.style.objectFit = 'contain';
    logo.style.margin = '0 auto 3mm';
    doc.body.appendChild(logo);
  }
  doc.body.appendChild(pre);
  doc.close();
  frame.contentWindow?.addEventListener('afterprint', () => frame.remove(), { once: true });
  window.setTimeout(() => frame.remove(), 60000);
}
export async function executeThermalPrint(
  payload: ThermalPrintPayload,
): Promise<ThermalPrintResponse & { dispatchedVia: 'NETWORK' | 'WEB_SERIAL' | 'BROWSER' }> {
  if (payload.kind === 'KITCHEN' && payload.items.length === 0) {
    throw new Error('Aucun article à imprimer pour ce ticket cuisine/bar.');
  }

  let printPayload = payload;
  if (payload.kind === 'RECEIPT') {
    try {
      const settings = await apiFetch<{ restaurant: { logoUrl?: string | null; printerSettings?: { paperWidth?: '58mm' | '80mm' } } }>('/api/restaurant/settings');
      if (settings.restaurant.logoUrl) {
        const logoRasterBase64 = await buildLogoRasterBase64(settings.restaurant.logoUrl, settings.restaurant.printerSettings?.paperWidth || '80mm');
        if (logoRasterBase64) printPayload = { ...payload, logoRasterBase64 };
      }
    } catch {
      // A missing logo or settings lookup must not block a receipt.
    }
  }
  const res = await apiFetch<ThermalPrintResponse>('/api/restaurant/print/escpos', {
    method: 'POST',
    body: JSON.stringify(printPayload),
  });

  if (res.mode === 'NETWORK_ESCPOS') {
    if (res.networkResult?.ok) {
      return { ...res, dispatchedVia: 'NETWORK' };
    }
    throw new Error(
      res.networkResult?.error ||
        'Impossible de joindre l’imprimante thermique réseau.',
    );
  }

  if (res.mode === 'WEB_SERIAL') {
    if (!supportsWebSerial()) {
      printThermalPreview(res.previewText, res.paperWidth, payload.kind === 'RECEIPT' ? res.logoUrl : null);
      return { ...res, dispatchedVia: 'BROWSER' };
    }
    const bytes = decodeBase64ToBytes(res.base64Bytes);
    await printViaWebSerial(bytes);
    return { ...res, dispatchedVia: 'WEB_SERIAL' };
  }

  printThermalPreview(res.previewText, res.paperWidth, payload.kind === 'RECEIPT' ? res.logoUrl : null);
  return { ...res, dispatchedVia: 'BROWSER' };
}
