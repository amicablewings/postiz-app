import {
  ThirdParty,
  ThirdPartyAbstract,
} from '@gitroom/nestjs-libraries/3rdparties/thirdparty.interface';
import {
  JoinBrandsMcpClient,
  resolveJoinBrandsToken,
} from '@gitroom/nestjs-libraries/3rdparties/joinbrands/joinbrands.mcp.client';

type JoinBrandsVideo = {
  video_url?: string;
  poster_url?: string;
  duration?: number;
};

type JoinBrandsContentRow = {
  id?: number;
  job_id?: number;
  campaign_id?: number;
  creator_name?: string;
  creator_id?: number;
  brand_name?: string;
  product_title?: string;
  content_type?: string;
  action_status?: string;
  job_status?: string;
  video_status?: string;
  is_rejected_by_brand?: boolean;
  file_url?: string;
  preview_url?: string;
  thumb_url?: string;
  published_video_url?: string;
  video?: JoinBrandsVideo;
};

type JoinBrandsListResponse = {
  rows?: JoinBrandsContentRow[];
  total_rows?: number;
};

type MediaLibraryItem = {
  id: string;
  url: string;
  thumbnail?: string;
  name: string;
  type: 'video' | 'image';
};

const PUBLIC_HOST = 'joinbrands-public.s3.us-east-2.amazonaws.com';

const isHttpUrl = (value?: string) =>
  !!value && /^https?:\/\//i.test(value) && value !== 'hidden';

const isPublicJoinBrandsUrl = (value?: string) =>
  isHttpUrl(value) && value!.includes(PUBLIC_HOST);

const mediaUrl = (row: JoinBrandsContentRow): string => {
  if (isPublicJoinBrandsUrl(row.video?.video_url)) {
    return row.video!.video_url!;
  }
  if (isPublicJoinBrandsUrl(row.file_url)) {
    return row.file_url!;
  }
  if (isPublicJoinBrandsUrl(row.preview_url)) {
    return row.preview_url!;
  }
  if (isHttpUrl(row.video?.video_url)) {
    return row.video!.video_url!;
  }
  if (isHttpUrl(row.file_url)) {
    return row.file_url!;
  }
  return '';
};

const thumbnailUrl = (row: JoinBrandsContentRow): string => {
  if (isHttpUrl(row.video?.poster_url)) {
    return row.video!.poster_url!;
  }
  if (isHttpUrl(row.thumb_url)) {
    return row.thumb_url!;
  }
  if (isHttpUrl(row.preview_url)) {
    return row.preview_url!;
  }
  return '';
};

const isImportable = (row: JoinBrandsContentRow) => {
  if (row.is_rejected_by_brand) {
    return false;
  }
  if (row.video_status && row.video_status !== 'PROCESSED' && row.video_status !== 'na') {
    return false;
  }
  return !!mediaUrl(row);
};

const itemName = (row: JoinBrandsContentRow) => {
  const creator = row.creator_name || 'creator';
  const product = row.product_title || row.brand_name || 'JoinBrands';
  return `${creator} - ${product} (${row.id})`;
};

@ThirdParty({
  identifier: 'joinbrands',
  title: 'JoinBrands',
  description:
    'Import approved creator videos from JoinBrands. Paste an MCP API token from JoinBrands Settings → AI integrations.',
  position: 'media-library',
  fields: [],
})
export class JoinBrandsProvider extends ThirdPartyAbstract {
  async checkConnection(
    apiKey: string
  ): Promise<false | { name: string; username: string; id: string }> {
    const token = resolveJoinBrandsToken(apiKey);
    if (!token) {
      return false;
    }

    try {
      const client = new JoinBrandsMcpClient(token);
      const campaigns = await client.callTool<{
        rows?: Array<{
          id?: number;
          title?: string;
          brand_name?: string;
          marketplace_short_code?: string;
        }>;
        total_rows?: number;
      }>('list_campaigns', {
        marketplace: process.env.JOINBRANDS_MARKETPLACE || 'us',
        rows: 5,
        search_phrase: process.env.JOINBRANDS_SEARCH || 'Teavity',
      });

      const first = campaigns.rows?.[0];
      return {
        name: first?.brand_name || 'JoinBrands',
        username: first?.brand_name || 'joinbrands',
        id: String(first?.id || 'joinbrands'),
      };
    } catch {
      return false;
    }
  }

  async listMedia(
    apiKey: string,
    data?: { page?: number }
  ): Promise<{ results: MediaLibraryItem[]; pages: number }> {
    const token = resolveJoinBrandsToken(apiKey);
    const client = new JoinBrandsMcpClient(token);
    const page = Math.max(1, data?.page || 1);
    const rows = 20;
    const campaignId = Number(process.env.JOINBRANDS_CAMPAIGN_ID || 71607);

    const payload = await client.callTool<JoinBrandsListResponse>(
      'list_job_contents',
      {
        marketplace: process.env.JOINBRANDS_MARKETPLACE || 'us',
        page: page - 1,
        rows,
        sort: 'newest',
        ...(campaignId ? { filter_campaign_id: campaignId } : {}),
      }
    );

    const results = (payload.rows || [])
      .filter(isImportable)
      .map((row) => {
        const url = mediaUrl(row);
        const type: 'video' | 'image' =
          row.content_type === 'image' || !row.video?.video_url
            ? 'image'
            : 'video';

        return {
          id: String(row.id),
          url,
          thumbnail: thumbnailUrl(row) || url,
          name: itemName(row),
          type,
        };
      })
      .filter((item) => isPublicJoinBrandsUrl(item.url));

    const total = payload.total_rows || results.length;
    return {
      results,
      pages: Math.max(1, Math.ceil(total / rows)),
    };
  }

  async importMedia(
    apiKey: string,
    items: { url: string; name: string }[]
  ): Promise<{ url: string; name: string }[]> {
    return items
      .filter((item) => isPublicJoinBrandsUrl(item.url))
      .map((item) => ({
        url: item.url.split('#')[0],
        name: item.name || 'joinbrands-media',
      }));
  }

  async sendData(): Promise<string> {
    throw new Error(
      'JoinBrands media-library provider does not support sendData'
    );
  }
}
