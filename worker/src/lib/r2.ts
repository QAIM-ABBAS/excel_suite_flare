export class R2Storage {
  constructor(private bucket: R2Bucket) {}

  async upload(key: string, data: ArrayBuffer, contentType: string): Promise<void> {
    await this.bucket.put(key, data, {
      httpMetadata: { contentType },
    });
  }

  async download(key: string): Promise<R2ObjectBody | null> {
    return await this.bucket.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const url = await this.bucket.presignedUrl(key, { expiresIn });
    return url.toString();
  }

  async listKeys(prefix: string = ''): Promise<string[]> {
    const result = await this.bucket.list({ prefix });
    return result.objects.map(obj => obj.key);
  }
}
