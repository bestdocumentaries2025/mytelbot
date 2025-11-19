import { TelegramBot } from 'node-telegram-bot-api';
import { createWriteStream, pipeline } from 'stream';
import { promisify } from 'util';
import got from 'got';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { v2 as cloudinary } from 'cloudinary';
import kv from '@vercel/kv';

// Set the path for ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Environment Variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const VERCEL_URL = process.env.VERCEL_URL;

// Initialize Cloudinary
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true,
});

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const streamPipeline = promisify(pipeline);

// Helper function for retrying API calls
const retry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise(res => setTimeout(res, delay));
    return retry(fn, retries - 1, delay * 2);
  }
};

export default async function handler(req, res) {
  // 1. Webhook Verification
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  if (secretToken !== TELEGRAM_WEBHOOK_SECRET) {
    console.error('Unauthorized webhook request.');
    return res.status(401).send('Unauthorized');
  }

  // 2. Handle Update
  const update = req.body;
  if (!update) {
    return res.status(200).send('OK');
  }
  
  // Handle different update types if needed (e.g., channel_post, edited_message)
  const message = update.message || update.channel_post;

  if (message && (message.video || message.document)) {
    const file = message.video || message.document;
    const chatId = message.chat.id;

    // 3. Size Check (Telegram sends file size in the update object)
    const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
    if (file.file_size > MAX_FILE_SIZE_BYTES) {
      await bot.sendMessage(chatId, `File is too large. Maximum size is 2GB.`);
      return res.status(413).send('Payload Too Large');
    }

    // Check if the document is a video
    if (message.document && !message.document.mime_type.startsWith('video/')) {
        await bot.sendMessage(chatId, `This is not a video file. Please send a video.`);
        return res.status(200).send('OK');
    }

    try {
      await bot.sendMessage(chatId, 'File received. Starting processing...');

      // 4. Get File Path from Telegram
      const telegramFile = await retry(() => bot.getFile(file.file_id));
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${telegramFile.file_path}`;

      // 5. Define processing streams
      const downloadStream = got.stream(fileUrl);
      const publicId = `telegram_video_${Date.now()}_${chatId}`;
      const expiryTimestamp = Date.now() + (24 * 60 * 60 * 1000); // 24 hours from now

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          public_id: publicId,
          folder: 'telegram_processed_videos/',
          format: 'mp4',
          // This is crucial for the expiring URL
          type: 'authenticated',
          expires_at: Math.round(expiryTimestamp / 1000),
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            bot.sendMessage(chatId, 'An error occurred during upload to Cloudinary.');
            return;
          }
          console.log('Cloudinary upload successful:', result);

          // 6. Store metadata in Vercel KV
          kv.set(`cloudinary:${publicId}`, expiryTimestamp.toString());
          
          // 7. Generate and send the expiring URL
          const streamUrl = cloudinary.url(publicId, {
            resource_type: 'video',
            secure: true,
            type: 'authenticated',
            expires_at: Math.round(expiryTimestamp / 1000),
            // Add streaming profile for better playback
            streaming_profile: 'full_hd'
          });

          bot.sendMessage(chatId, `Processing complete! Your video will be available for 24 hours:\n${streamUrl}`);
        }
      );

      // 8. Process with ffmpeg and stream to Cloudinary
      const ffmpegProcess = ffmpeg({ source: downloadStream })
        .videoCodec('libx264')
        .audioCodec('aac')
        .size('1080x720')
        .format('mp4')
        .outputOptions('-movflags +frag_keyframe+empty_moov')
        .on('error', (err, stdout, stderr) => {
          console.error('FFmpeg error:', err.message);
          console.error('FFmpeg stderr:', stderr);
          bot.sendMessage(chatId, 'An error occurred during video processing.');
        })
        .on('end', () => {
          console.log('FFmpeg processing finished.');
        })
        .pipe();

      // 9. Pipe everything together
      await streamPipeline(ffmpegProcess, uploadStream);

    } catch (error) {
      console.error('General processing error:', error);
      await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  res.status(200).send('OK');
}