// Fotos: se reducen en el móvil antes de subirlas para que ocupen poco y carguen rápido.

export async function resizeImage(file, { maxSize = 1280, quality = 0.8 } = {}) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('Elige una imagen (JPG, PNG o HEIC).');
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('No se ha podido procesar la foto. Prueba con otra.');
  return blob;
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Algunos navegadores no aceptan opciones: seguimos con <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('No se ha podido leer la foto. Prueba con otra.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se ha podido leer la foto.'));
    reader.readAsDataURL(blob);
  });
}
