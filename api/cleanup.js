// api/cleanup.js
import { v2 as cloudinary } from 'cloudinary';
import kv from '@vercel/kv';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ status: 'unauthorized' });
  }

  console.log('Running daily cleanup task...');
  try {
    const keys = await kv.keys('cloudinary:*');
    if (!keys || keys.length === 0) {
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
      await cloudinary.api.delete_resources(resourcesToDelete, { resource_type: 'video', type: 'authenticated' });
      for (const publicId of resourcesToDelete) {
        await kv.del(`cloudinary:${publicId}`);
      }
      return res.status(200).json({ status: 'success', deleted: resourcesToDelete });
    }
    
    return res.status(200).json({ status: 'success', message: 'No expired resources to clean.' });
  } catch (error) {
    console.error('Cleanup failed:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
}