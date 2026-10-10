import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { GetMediaDto } from '@gitroom/nestjs-libraries/dtos/media/get.media.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

type MediaImageRef = { id?: string; path?: string };
type MediaUsage = {
  brands: { id: string; name: string }[];
  campaigns: {
    group: string;
    publishDate: string;
    label: string;
    customerId: string | null;
    customerName: string | null;
    channels: string[];
    href: string;
  }[];
};

@Injectable()
export class MediaRepository {
  constructor(
    private _media: PrismaRepository<'media'>,
    private _post: PrismaRepository<'post'>
  ) {}

  saveFile(org: string, fileName: string, filePath: string, originalName?: string) {
    return this._media.model.media.create({
      data: {
        organization: {
          connect: {
            id: org,
          },
        },
        name: fileName,
        path: filePath,
        originalName: originalName || null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        status: true,
      },
    });
  }

  startProcessing(org: string, id: string) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: { status: 'processing', processingError: null },
      select: { id: true, status: true },
    });
  }

  finishProcessing(
    org: string,
    id: string,
    data: { name?: string; path?: string; fileSize?: number; error?: string }
  ) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.path ? { path: data.path } : {}),
        ...(data.fileSize ? { fileSize: data.fileSize } : {}),
        status: data.error ? 'failed' : 'ready',
        processingError: data.error || null,
      },
      select: { id: true, status: true },
    });
  }

  getMediaStatus(org: string, id: string) {
    return this._media.model.media.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        status: true,
        processingError: true,
      },
    });
  }

  getMediaById(id: string) {
    return this._media.model.media.findUnique({
      where: {
        id,
      },
    });
  }

  deleteMedia(org: string, id: string) {
    return this._media.model.media.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._media.model.media.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getMedia(org: string, query: GetMediaDto) {
    const pageNum = (query.page || 1) - 1;
    const trimmedSearch = query.search?.trim();
    const searchFilter = trimmedSearch
      ? {
          originalName: {
            contains: trimmedSearch,
            mode: 'insensitive' as const,
          },
        }
      : {};
    const typeFilter =
      query.type === 'video'
        ? {
            path: {
              contains: '.mp4',
              mode: 'insensitive' as const,
            },
          }
        : query.type === 'image'
        ? {
            NOT: {
              path: {
                contains: '.mp4',
                mode: 'insensitive' as const,
              },
            },
          }
        : {};
    const brandFilter = await this.brandIdFilter(org, query.brand);
    if (brandFilter === null) {
      return { pages: 0, results: [] };
    }
    const where = {
      organizationId: org,
      deletedAt: null,
      // still being normalized: it shows up once the workflow releases it
      status: { not: 'processing' as const },
      ...searchFilter,
      ...typeFilter,
      ...brandFilter,
    };
    const pages = Math.ceil(
      (await this._media.model.media.count({ where })) / 18
    );
    const results = await this._media.model.media.findMany({
      where,
      orderBy:
        query.sort === 'oldest'
          ? { createdAt: 'asc' }
          : query.sort === 'name'
          ? [{ originalName: 'asc' }, { createdAt: 'desc' }]
          : { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        createdAt: true,
      },
      skip: pageNum * 18,
      take: 18,
    });
    const usage = await this.usageFor(org, results);

    return {
      pages,
      results: results.map((media) => ({
        ...media,
        ...(usage.get(media.id) || { brands: [], campaigns: [] }),
      })),
    };
  }

  // null means the brand filter matches nothing.
  private async brandIdFilter(org: string, brand?: string) {
    if (!brand) {
      return {};
    }
    const ids = await this.referencedMediaIds(
      org,
      brand === 'none' ? undefined : brand
    );
    if (brand === 'none') {
      if (!ids.size) {
        return {};
      }
      return { id: { notIn: [...ids] } };
    }
    if (!ids.size) {
      return null;
    }
    return { id: { in: [...ids] } };
  }

  private async referencedMediaIds(org: string, customerId?: string) {
    const posts = await this._post.model.post.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        image: { not: null },
        ...(customerId
          ? {
              integration: {
                customerId,
              },
            }
          : {}),
      },
      select: {
        image: true,
      },
    });
    const ids = new Set<string>();
    for (const post of posts) {
      for (const item of this.parseImages(post.image)) {
        if (item?.id) {
          ids.add(item.id);
        }
      }
    }
    return ids;
  }

  private async usageFor(
    org: string,
    media: { id: string; path: string }[]
  ) {
    const usage = new Map<string, MediaUsage>();
    if (!media.length) {
      return usage;
    }
    const posts = await this._post.model.post.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        OR: media.flatMap((item) => [
          { image: { contains: item.id } },
          ...(item.path ? [{ image: { contains: item.path } }] : []),
        ]),
      },
      select: {
        group: true,
        publishDate: true,
        content: true,
        image: true,
        integration: {
          select: {
            name: true,
            customer: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        publishDate: 'desc',
      },
    });

    for (const item of media) {
      const matches = posts.filter((post) =>
        this.parseImages(post.image).some(
          (image) =>
            image?.id === item.id || (!!item.path && image?.path === item.path)
        )
      );
      const brands = new Map<string, string>();
      const campaigns = new Map<
        string,
        MediaUsage['campaigns'][number] & {
          channels: string[];
          snippet: string;
        }
      >();
      for (const post of matches) {
        const customer = post.integration?.customer;
        if (customer?.id) {
          brands.set(customer.id, customer.name);
        }
        const existing = campaigns.get(post.group);
        const channel = post.integration?.name;
        if (existing) {
          if (channel && !existing.channels.includes(channel)) {
            existing.channels.push(channel);
            existing.label = this.campaignLabel(
              existing.publishDate,
              existing.channels,
              existing.snippet
            );
          }
          continue;
        }
        const channels = channel ? [channel] : [];
        const publishDate = post.publishDate.toISOString();
        const snippet = this.plainText(post.content);
        campaigns.set(post.group, {
          group: post.group,
          publishDate,
          customerId: customer?.id || null,
          customerName: customer?.name || null,
          channels,
          snippet,
          label: this.campaignLabel(publishDate, channels, snippet),
          href: this.campaignHref(publishDate, customer?.id || '', post.group),
        });
      }
      usage.set(item.id, {
        brands: [...brands.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        campaigns: [...campaigns.values()].slice(0, 8).map(
          ({ snippet: _snippet, ...campaign }) => campaign
        ),
      });
    }
    return usage;
  }

  private campaignHref(publishDate: string, customerId: string, group: string) {
    const date = dayjs(publishDate);
    const params = new URLSearchParams({
      display: 'week',
      startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
      endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      customer: customerId,
      group,
    });
    return `/launches?${params.toString()}`;
  }

  private campaignLabel(publishDate: string, channels: string[], content: string) {
    const when = dayjs(publishDate).format('MMM D, YYYY');
    const where = channels.filter(Boolean).join(', ');
    const title = content ? content.slice(0, 80) : '';
    return [when, where, title].filter(Boolean).join(' | ');
  }

  private plainText(content: string) {
    return (content || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseImages(image: string | null): MediaImageRef[] {
    if (!image) {
      return [];
    }
    try {
      const parsed = JSON.parse(image);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
