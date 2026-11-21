import { apiFetch } from '../services/api';

interface ImageUploadTicket {
  uploadUrl: string;
  publicUrl: string;
  method: 'PUT';
  contentType: string;
  maxBytes: number;
}

export async function uploadRestaurantImage(file: File, kind: 'menu' | 'logo'): Promise<string> {
  const ticket = await apiFetch<ImageUploadTicket>('/api/restaurant/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({ kind, contentType: file.type, size: file.size }),
  });
  if (file.size > ticket.maxBytes) throw new Error('Image trop volumineuse (maximum 5 Mo).');
  const response = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: { 'Content-Type': ticket.contentType },
    body: file,
  });
  if (!response.ok) throw new Error(`Échec de l’envoi de l’image (HTTP ${response.status}).`);
  return ticket.publicUrl;
}
