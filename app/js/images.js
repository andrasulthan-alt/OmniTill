// Photos for menu items and rooms.
// A photo is shrunk on the device (longest side 640 px, WebP) before upload, so it stays small and fast,
// and the original file (with its location and camera data) never leaves the device.
import { h, mount } from './util.js';
import { S } from './state.js';

const BUCKET = 'images';
const MAX_SIDE = 640;

export function pickImage() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*' });
    input.addEventListener('change', () => resolve(input.files && input.files[0] ? input.files[0] : null), { once: true });
    input.click();
  });
}

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

export async function shrink(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose a photo (JPG, PNG or WebP).');
  if (file.size > 30 * 1024 * 1024) throw new Error('This photo is too large.');
  let src;
  try { src = await decode(file); } catch { throw new Error('This photo could not be read. Try a JPG or PNG.'); }
  const w = src.width, ht = src.height;
  const k = Math.min(1, MAX_SIDE / Math.max(w, ht));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(ht * k));
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  let blob = await toBlob(canvas, 'image/webp', 0.8);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.82);
  if (!blob) throw new Error('This photo could not be processed.');
  return blob;
}

export async function uploadImage(folder, id, blob) {
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${folder}/${id}-${Date.now().toString(36)}.${ext}`;
  const { error } = await S.sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/row-level security|unauthori|403/i.test(error.message) ? 'Only a manager can change photos.' : error.message);
  return S.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Best effort: an unused old photo is deleted, a failure here never blocks saving.
export async function removeImage(url) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url ? url.indexOf(marker) : -1;
  if (i < 0) return;
  try { await S.sb.storage.from(BUCKET).remove([decodeURIComponent(url.slice(i + marker.length))]); } catch { /* ignore */ }
}

export function photo(url, alt, cls = 'ph') {
  if (!url) return null;
  const img = h('img', { src: url, alt: alt || '', class: cls, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

// Stand-in for a missing photo when other cards in the same grid have one, so the grid stays even.
export function photoOrBlank(url, label, useBlank) {
  if (url) return photo(url);
  if (!useBlank) return null;
  const letters = String(label || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  return h('span', { class: 'ph ph-none', 'aria-hidden': 'true' }, letters);
}

// A small form control: preview + choose / change / remove. Read the result with .result().
export function photoField(current, label = 'Photo') {
  const st = { url: current || '', blob: null, removed: false, preview: null };
  const box = h('div', { class: 'img-field' });
  const err = h('small', { class: 'form-err' });
  function draw() {
    if (st.preview) URL.revokeObjectURL(st.preview);
    st.preview = st.blob ? URL.createObjectURL(st.blob) : null;
    const src = st.preview || (st.removed ? '' : st.url);
    mount(box,
      src ? h('img', { class: 'prev', src, alt: '' }) : h('div', { class: 'prev none' }, 'No photo'),
      h('div', { class: 'col gap' },
        h('button', { type: 'button', class: 'btn sm', onclick: choose }, src ? 'Change photo' : 'Add photo'),
        src ? h('button', { type: 'button', class: 'btn sm', onclick: () => { st.blob = null; st.removed = true; draw(); } }, 'Remove') : null),
      err);
  }
  async function choose() {
    err.textContent = '';
    const f = await pickImage();
    if (!f) return;
    try { st.blob = await shrink(f); st.removed = false; draw(); } catch (e) { err.textContent = e.message; }
  }
  draw();
  return {
    el: h('div', { class: 'field' }, h('span', null, label), box),
    changed: () => !!st.blob || (st.removed && !!st.url),
    // Uploads a new photo if one was chosen. Returns the image_url to save ('' when removed).
    async save(folder, id) {
      if (st.blob) { const url = await uploadImage(folder, id, st.blob); if (st.url) removeImage(st.url); return url; }
      if (st.removed) { if (st.url) removeImage(st.url); return ''; }
      return st.url;
    },
  };
}
