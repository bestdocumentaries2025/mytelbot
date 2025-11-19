// api/bot.js
import { TelegramBot } from 'node-telegram-bot-api';
import { pipeline } from 'stream';
import { promisify } from 'util';
import got from 'got';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { v2 as cloudinary } from 'cloudinary';
import kv from '@vercel/kv';

// Set the path for ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Initialize Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const streamPipeline = promisify(pipeline);

export default async function handler(req, res) {
  // 1. Webhook Verification
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  if (secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.error('Unauthorized webhook request.');
    return res.status(401).send('Unauthorized');
  }

  const message = req.body.message;

  if (message && (message.video || message.document)) {
    const chatId = message.chat.id;
    const file = message.video || message.document;

    if (message.document && !file.mime_type.startsWith('video/')) {
        await bot.sendMessage(chatId, `This is not a video file. Please send a video.`);
        return res.status(200).send('OK');
    }

    try {
      await bot.sendMessage(chatId, 'File received. Starting processing...');

      const telegramFile = await bot.getFile(file.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${telegramFile.file_path}`;

      const downloadStream = got.stream(fileUrl);
      const publicId = `telegram_video_${Date.now()}_${chatId}`;
      const expiryTimestamp = Date.now() + (24 * 60 * 60 * 1000);

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          public_id: publicId,
          folder: 'telegram_processed_videos/',
          format: 'mp4',
          type: 'authenticated',
          expires_at: Math.round(expiryTimestamp / 1000),
        },
        async (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            await bot.sendMessage(chatId, 'An error occurred during upload to Cloudinary.');
            return;
          }
          console.log('Cloudinary upload successful:', result.public_id);
          await kv.set(`cloudinary:${publicId}`, expiryTimestamp.toString());
          
          const streamUrl = cloudinary.url(publicId, {
            resource_type: 'video',
            secure: true,
            type: 'authenticated',
            expires_at: Math.round(expiryTimestamp / 1000),
            streaming_profile: 'full_hd'
          });

          await bot.sendMessage(chatId, `Processing complete! Your video will be available for 24 hours:\n${streamUrl}`);
        }
      );

      const ffmpegProcess = ffmpeg({ source: downloadStream })
        .videoCodec('libx264')
        .audioCodec('aac')
        .size('1080x720')
        .format('mp4')
        .outputOptions('-movflags +frag_keyframe+empty_moov')
        .on('error', (err, stdout, stderr) => {
          console.error('FFmpeg error:', err.message);
          bot.sendMessage(chatId, 'An error occurred during video processing.');
        })
        .pipe();

      await streamPipeline(ffmpegProcess, uploadStream);

    } catch (error) {
      console.error('General processing error:', error);
      await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  }

  res.status(200).send('OK');
}