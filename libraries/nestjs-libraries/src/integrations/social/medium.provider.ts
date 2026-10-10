import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { MediumSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

type MediumSessionCookies = {
  sid: string;
  uid: string;
  xsrf: string;
  cf_clearance: string;
  _cfuvid?: string;
};

const VIEWER = `
  query Viewer {
    viewer { id username name imageId }
  }
`;

const CREATE_POST = `
  mutation CreatePostMutation($input: CreatePostInput!) {
    createPost(input: $input) {
      id
      mediumUrl
      title
      creator { id username name }
    }
  }
`;

// Medium retired new integration tokens. Session cookies + GraphQL match Medium MCP.
export class MediumProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3;
  identifier = 'medium';
  name = 'Medium';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = MediumSettingsDto;
  toolTip =
    'Medium retired new integration tokens. Connect with session cookies (sid, uid, xsrf) from a signed-in medium.com browser, same approach as Medium MCP.';

  maxLength() {
    return 100000;
  }

  async customFields() {
    return [
      {
        key: 'sid',
        label: 'sid cookie',
        validation: `/^.{8,}$/`,
        type: 'password' as const,
        hint: 'DevTools → Application → Cookies → medium.com → sid',
      },
      {
        key: 'uid',
        label: 'uid cookie',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
        hint: 'DevTools → Application → Cookies → .medium.com → uid',
      },
      {
        key: 'xsrf',
        label: 'xsrf cookie',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
        hint: 'DevTools → Application → Cookies → medium.com → xsrf',
      },
      {
        key: 'cf_clearance',
        label: 'cf_clearance cookie',
        validation: `/^.{10,}$/`,
        type: 'password' as const,
        hint: 'Required for Cloudflare. DevTools → Cookies → .medium.com → cf_clearance',
      },
    ];
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async refreshToken(_refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  private cookieHeader(cookies: MediumSessionCookies) {
    const parts = [
      `sid=${cookies.sid}`,
      `uid=${cookies.uid}`,
      `xsrf=${cookies.xsrf}`,
    ];
    if (cookies.cf_clearance) {
      parts.push(`cf_clearance=${cookies.cf_clearance}`);
    }
    if (cookies._cfuvid) {
      parts.push(`_cfuvid=${cookies._cfuvid}`);
    }
    return parts.join('; ');
  }

  private paragraphsFromText(body: string, subtitle?: string) {
    const blocks = String(body || '')
      .replace(/\r\n/g, '\n')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
      .split(/\n{2,}/)
      .map((block) => block.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (subtitle?.trim()) {
      blocks.unshift(subtitle.trim());
    }
    return blocks;
  }

  private getCookies(
    integration: Integration | undefined,
    accessToken?: string,
  ): MediumSessionCookies | null {
    const tryParse = (raw?: string | null) => {
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(AuthService.fixedDecryption(raw)) as Partial<
          MediumSessionCookies
        >;
        if (parsed?.sid && parsed?.uid && parsed?.xsrf && parsed?.cf_clearance) {
          return parsed as MediumSessionCookies;
        }
      } catch {
        try {
          const parsed = JSON.parse(raw) as Partial<MediumSessionCookies>;
          if (parsed?.sid && parsed?.uid && parsed?.xsrf) {
            return parsed as MediumSessionCookies;
          }
        } catch {
          return null;
        }
      }
      return null;
    };
    return (
      tryParse(integration?.customInstanceDetails) ||
      tryParse(accessToken) ||
      null
    );
  }

  private async gql(
    cookies: MediumSessionCookies,
    operation: string,
    query: string,
    variables: Record<string, unknown> = {},
  ) {
    const response = await fetch('https://medium.com/_/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'graphql-operation': operation,
        'x-xsrf-token': decodeURIComponent(cookies.xsrf),
        cookie: this.cookieHeader(cookies),
        origin: 'https://medium.com',
        referer: 'https://medium.com/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        operationName: operation,
        query,
        variables,
      }),
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Medium refused the session. Refresh sid/uid/xsrf cookies.',
      );
    }
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        `Medium returned HTML for ${operation}. Session may need a fresh Cloudflare clearance.`,
      );
    }
    let parsed: {
      data?: Record<string, unknown>;
      errors?: Array<{ message?: string }>;
    };
    try {
      const json = JSON.parse(text) as typeof parsed | Array<typeof parsed>;
      parsed = Array.isArray(json) ? json[0] || {} : json;
    } catch {
      throw new Error(
        `${operation} returned unreadable JSON (HTTP ${response.status}).`,
      );
    }
    if (parsed.errors?.length) {
      throw new Error(
        parsed.errors
          .map((error) => error.message || 'GraphQL error')
          .join('; '),
      );
    }
    if (response.status >= 400) {
      throw new Error(`${operation} failed with HTTP ${response.status}.`);
    }
    return parsed.data || {};
  }

  private async saveDeltas(
    cookies: MediumSessionCookies,
    postId: string,
    title: string,
    paragraphs: string[],
  ) {
    const deltas = [
      { type: 1, index: 0, paragraph: { type: 3, text: title, markups: [] } },
      ...paragraphs.map((text, offset) => ({
        type: 1,
        index: offset + 1,
        paragraph: { type: 1, text, markups: [] },
      })),
    ];
    const response = await fetch(`https://medium.com/p/${postId}/deltas`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-xsrf-token': decodeURIComponent(cookies.xsrf),
        cookie: this.cookieHeader(cookies),
        origin: 'https://medium.com',
        referer: `https://medium.com/p/${postId}/edit`,
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ baseRev: -1, rev: 0, deltas }),
    });
    let text = await response.text();
    const jsonStart = text.indexOf('{');
    if (text.startsWith('])}') && jsonStart >= 0) {
      text = text.slice(jsonStart);
    }
    let body: { success?: boolean; payload?: unknown; error?: unknown };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(
        `Draft save returned unreadable JSON (HTTP ${response.status}).`,
      );
    }
    if (response.status >= 400 || body.success === false) {
      throw new Error(
        `Draft save failed (HTTP ${response.status}): ${JSON.stringify(
          body.error ?? body,
        ).slice(0, 500)}`,
      );
    }
    return body.payload ?? body;
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    try {
      const body = JSON.parse(Buffer.from(params.code, 'base64').toString());
      if (body.apiKey && !body.sid) {
        const {
          data: { name, id, imageUrl, username },
        } = await (
          await fetch('https://api.medium.com/v1/me', {
            headers: {
              Authorization: `Bearer ${body.apiKey}`,
            },
          })
        ).json();

        return {
          refreshToken: '',
          expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
          accessToken: body.apiKey,
          id,
          name,
          picture: imageUrl || '',
          username,
        };
      }

      const cookies: MediumSessionCookies = {
        sid: String(body.sid || '').trim(),
        uid: String(body.uid || '').trim(),
        xsrf: String(body.xsrf || '').trim(),
        cf_clearance: String(body.cf_clearance || '').trim(),
        _cfuvid: String(body._cfuvid || '').trim() || undefined,
      };
      if (!cookies.sid || !cookies.uid || !cookies.xsrf || !cookies.cf_clearance) {
        return 'Missing Medium session cookies (sid, uid, xsrf, cf_clearance)';
      }

      const data = await this.gql(cookies, 'Viewer', VIEWER);
      const viewer = data.viewer as
        | { id?: string; username?: string; name?: string; imageId?: string }
        | null;
      if (!viewer?.id) {
        return 'Invalid Medium session cookies';
      }

      const encrypted = AuthService.fixedEncryption(JSON.stringify(cookies));
      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: encrypted,
        id: viewer.id,
        name: viewer.name || viewer.username || 'Medium',
        picture: viewer.imageId
          ? `https://miro.medium.com/v2/resize:fill:128:128/${viewer.imageId}`
          : '',
        username: viewer.username || viewer.id,
      };
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid credentials';
    }
  }

  @Tool({ description: 'List of publications', dataSchema: [] })
  async publications(
    accessToken: string,
    _: any,
    id: string,
    integration?: Integration,
  ) {
    const cookies = this.getCookies(integration, accessToken);
    if (!cookies) {
      try {
        const { data } = await (
          await fetch(`https://api.medium.com/v1/users/${id}/publications`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          })
        ).json();
        return data || [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
  ): Promise<PostResponse[]> {
    const cookies = this.getCookies(integration, accessToken);
    const { settings } = postDetails?.[0] || { settings: {} };
    const message = postDetails?.[0]?.message || '';

    if (!cookies) {
      const { data } = await (
        await fetch(
          settings?.publication
            ? `https://api.medium.com/v1/publications/${settings?.publication}/posts`
            : `https://api.medium.com/v1/users/${id}/posts`,
          {
            method: 'POST',
            body: JSON.stringify({
              title: settings.title,
              contentFormat: 'markdown',
              content: message,
              ...(settings.canonical
                ? { canonicalUrl: settings.canonical }
                : {}),
              ...(settings?.tags?.length
                ? { tags: settings?.tags?.map((tag: any) => tag.value) }
                : {}),
              publishStatus: settings?.publication ? 'draft' : 'public',
            }),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        )
      ).json();

      return [
        {
          id: postDetails?.[0].id,
          status: 'completed',
          postId: data.id,
          releaseURL: data.url,
        },
      ];
    }

    const title = String(settings?.title || '').trim();
    if (!title) {
      throw new Error('Medium requires a title');
    }
    const paragraphs = this.paragraphsFromText(message, settings?.subtitle);
    if (!paragraphs.length) {
      throw new Error('Medium requires a body');
    }

    const created = (
      await this.gql(cookies, 'CreatePostMutation', CREATE_POST, {
        input: {},
      })
    ).createPost as { id?: string; mediumUrl?: string } | undefined;
    if (!created?.id) {
      throw new Error('Medium createPost did not return a draft id');
    }
    await this.saveDeltas(cookies, created.id, title, paragraphs);
    const editUrl = `https://medium.com/p/${created.id}/edit`;
    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: created.id,
        releaseURL: created.mediumUrl || editUrl,
      },
    ];
  }
}
