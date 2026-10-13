import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate?: number;
}

export function probeVideo(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return reject(
          new Error(`FFprobe failed to inspect file: ${err.message}`),
        );
      }

      const videoStream = metadata.streams?.find(
        (s) => s.codec_type === 'video',
      );
      const duration = metadata.format?.duration || videoStream?.duration || 0;
      const width = videoStream?.width || 0;
      const height = videoStream?.height || 0;
      const codec = videoStream?.codec_name || 'unknown';
      const bitrate = metadata.format?.bit_rate
        ? parseInt(String(metadata.format.bit_rate), 10)
        : undefined;

      resolve({
        duration: Math.round(Number(duration)),
        width: Number(width),
        height: Number(height),
        codec: String(codec),
        bitrate,
      });
    });
  });
}

export function extractThumbnail(
  videoFilePath: string,
  outputThumbnailPath: string,
  timestamp = '00:00:01',
): Promise<string> {
  const folder = path.dirname(outputThumbnailPath);
  const filename = path.basename(outputThumbnailPath);

  return new Promise((resolve, reject) => {
    ffmpeg(videoFilePath)
      .screenshots({
        timestamps: [timestamp],
        filename,
        folder,
        size: '1280x720',
      })
      .on('end', () => resolve(outputThumbnailPath))
      .on('error', (err) =>
        reject(new Error(`FFmpeg failed to extract thumbnail: ${err.message}`)),
      );
  });
}
