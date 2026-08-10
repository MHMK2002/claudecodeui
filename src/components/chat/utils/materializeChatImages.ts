import { authenticatedFetch } from '../../../utils/api';
import type { ChatImage } from '../types/types';

const fileNameForImage = (image: ChatImage, index: number): string => (
  image.name
  || image.path?.split(/[\\/]/).pop()
  || `rewound-image-${index + 1}`
);

const dataUrlToFile = async (image: ChatImage, index: number): Promise<File | null> => {
  if (!image.data) return null;
  try {
    const response = await fetch(image.data);
    const blob = await response.blob();
    return new File([blob], fileNameForImage(image, index), {
      type: image.mimeType || blob.type || 'application/octet-stream',
    });
  } catch {
    return null;
  }
};

const pathToFile = async (
  image: ChatImage,
  index: number,
  projectId?: string | null,
): Promise<File | null> => {
  if (!image.path) return null;
  const filename = image.path.split(/[\\/]/).pop() || fileNameForImage(image, index);
  const urls = [
    `/api/assets/images/${encodeURIComponent(filename)}`,
    ...(projectId
      ? [`/api/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(image.path)}`]
      : []),
  ];

  for (const url of urls) {
    try {
      const response = await authenticatedFetch(url);
      if (!response.ok) continue;
      const blob = await response.blob();
      return new File([blob], fileNameForImage(image, index), {
        type: image.mimeType || blob.type || 'application/octet-stream',
      });
    } catch {
      // Try the legacy project-file fallback before dropping the attachment.
    }
  }
  return null;
};

/** Converts history attachment descriptors back into composer-owned Files. */
export async function materializeChatImages(
  images: ChatImage[],
  projectId?: string | null,
): Promise<File[]> {
  const candidates = images.slice(0, 5);
  const files = await Promise.all(candidates.map(async (image, index) => (
    dataUrlToFile(image, index).then((file) => file ?? pathToFile(image, index, projectId))
  )));
  return files.filter((file): file is File => file !== null);
}
