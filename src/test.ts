import encodeJpeg from '@jsquash/jpeg/encode';

export async function test() {
  const canvas = document.createElement('canvas');
  canvas.width = 10;
  canvas.height = 10;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, 10, 10);
  const buffer = await encodeJpeg(imageData, { quality: 80 });
  console.log(buffer);
}
