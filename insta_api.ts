import { instagramGetUrl } from './insta_get_direct_url';
import axios from 'axios';
import * as path from 'path';
import { Vault, normalizePath } from 'obsidian';
import * as https from 'https';
import { IncomingMessage } from 'http';

interface ReelDownloadResult {
  success: boolean;
  filePath?: string;
  thumbnailPath?: string;
  error?: string;
  postInfo?: any;
  mediaDetails?: any;
  caption?: string;
}

function extractReelId(url: string): string {
  const matches = url.match(/instagram\.com\/(reel|p)\/([^/?]+)/);
  if (!matches) throw new Error('Could not extract reel ID from URL');
  return matches[2];
}

async function checkFileExists(vault: Vault, filePath: string): Promise<boolean> {
  try {
    return await vault.adapter.exists(filePath);
  } catch {
    return false;
  }
}

async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (response: IncomingMessage) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        return;
      }

      const data: Uint8Array[] = [];
      response.on('data', (chunk) => data.push(chunk));
      response.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', (err) => reject(err));
  });
}

async function saveFile(vault: Vault, filePath: string, data: Buffer): Promise<void> {
  await vault.adapter.writeBinary(filePath, data);
}

export async function downloadInstagramReel(
  reelUrl: string,
  outputDir: string = './downloads',
  rewriteIfExists: boolean = false,
  vault: Vault
): Promise<ReelDownloadResult> {
  try {
    if (!reelUrl.includes('instagram.com')) {
      throw new Error('Invalid Instagram URL');
    }

    const reelId = extractReelId(reelUrl);
    const videoPath = normalizePath(path.join(outputDir, `reel_${reelId}.mp4`));
    const thumbnailPath = normalizePath(path.join(outputDir, `reel_${reelId}_thumb.jpg`));

    const videoExists = await checkFileExists(vault, videoPath);
    const thumbnailExists = await checkFileExists(vault, thumbnailPath);

    // even if video exists, we still need to get other info

    // if (videoExists && !rewriteIfExists) {
    //   return {
    //     success: true,
    //     filePath: videoPath,
    //     thumbnailPath: thumbnailExists ? thumbnailPath : undefined
    //   };
    // }

    const response = await instagramGetUrl(reelUrl);
    // console.log(response);

    const mediaDetails = response.media_details?.[0];
    if (!mediaDetails?.url) {
      throw new Error('Could not extract video URL');
    }

    if (!videoExists || rewriteIfExists) {
      const videoData = await downloadFile(mediaDetails.url);
      await saveFile(vault, videoPath, videoData);
    }

    if (mediaDetails.thumbnail && (!thumbnailExists || rewriteIfExists)) {
      const thumbnailData = await downloadFile(mediaDetails.thumbnail);
      await saveFile(vault, thumbnailPath, thumbnailData);
    }

    return {
      success: true,
      filePath: videoPath,
      thumbnailPath: mediaDetails.thumbnail ? thumbnailPath : undefined,
      postInfo: response.post_info,
      mediaDetails,
      caption: response.caption
    };

  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// Example usage:
// const result = await downloadInstagramReel('https://www.instagram.com/reel/ABC123...');
// if (result.success) {
//   console.log(`Reel downloaded to: ${result.filePath}`);
// } else {
//   console.error(`Download failed: ${result.error}`);
// } 