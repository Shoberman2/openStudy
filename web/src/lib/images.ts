"use client";

import { createStore, del, get, set } from "idb-keyval";

let imgStore: ReturnType<typeof createStore> | null = null;
function store() {
  if (!imgStore) imgStore = createStore("openstudy-images", "thumbs");
  return imgStore;
}

export async function saveImage(key: string, blob: Blob): Promise<void> {
  await set(key, blob, store());
}

export async function getImage(key: string): Promise<Blob | undefined> {
  try {
    return await get(key, store());
  } catch {
    return undefined;
  }
}

export async function deleteImage(key: string): Promise<void> {
  try {
    await del(key, store());
  } catch {
    /* ignore */
  }
}

/** Downscale to max 900px on the long edge, JPEG 0.72 (spec 3.1). */
export async function makeThumbnail(bitmap: ImageBitmap, max = 900): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("thumb"))), "image/jpeg", 0.72));
}
