import { v2 as cloudinary } from 'cloudinary';
import kv from '@vercel/kv';

// Environment Variables
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

// Initialize Cloudinary
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true,
});

export default async function handler(req, res) {
  // Simple security check for the cron endpoint
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ status: 'unauthorized' });
  }

  console.log('Running daily cleanup task...');

  try {
    const keys = await kv.keys('cloudinary:*');
    if (!keys || keys.length === 0) {
      console.log('No expired resources found.');
      return res.status(200).json({ status: 'success', message: 'No resources to clean.' });
    }

    const now = Date.now();
    const resourcesToDelete = [];

    for (const key of keys) {
      const expiryTimestamp = parseInt(await kv.get(key), 10);
      if (now > expiryTimestamp) {
        const publicId = key.replace('cloudinary:', '');
        resourcesToDelete.push(publicId);
      }
    }

    if (resourcesToDelete.length > 0) {
      console.log(`Found ${resourcesToDelete.length} expired resources to delete.`);
      const result = await cloudinary.api.delete_resources(resourcesToDelete, {
        resource_type: 'video',
        type: 'authenticated',
      });

      console.log('Cloudinary deletion result:', result);

      // Remove keys from KV after successful deletion
      for (const publicId of resourcesToDelete) {
        await kv.del(`cloudinary:${publicId}`);
      }
      
      return res.status(200).json({ status: 'success', deleted: resourcesToDelete });
    } else {
      console.log('No expired resources found.');
      return res.status(200).json({ status: 'success', message: 'No expired resources to clean.' });
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
}