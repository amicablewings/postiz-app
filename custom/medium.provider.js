"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediumProvider = void 0;
const tslib_1 = require("tslib");
const social_abstract_1 = require("../social.abstract");
const dayjs_1 = tslib_1.__importDefault(require("dayjs"));
const make_secure_id_1 = require("../../services/make.secure.id");
const medium_settings_dto_1 = require("../../dtos/posts/providers-settings/medium.settings.dto");
const tool_decorator_1 = require("../tool.decorator");
const auth_service_1 = require("../../../../helpers/src/auth/auth.service");

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

const HUNDRED_YEARS_SECONDS = 100 * 365 * 24 * 60 * 60;

function cookieHeader(cookies) {
  const parts = [
    `sid=${cookies.sid}`,
    `uid=${cookies.uid}`,
    `xsrf=${cookies.xsrf}`,
  ];
  if (cookies.cf_clearance) parts.push(`cf_clearance=${cookies.cf_clearance}`);
  if (cookies._cfuvid) parts.push(`_cfuvid=${cookies._cfuvid}`);
  return parts.join("; ");
}

function paragraphsFromText(body, subtitle) {
  const blocks = String(body || "")
    .replace(/\r\n/g, "\n")
    // Drop markdown image/link syntax; keep readable text for GraphQL deltas.
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (subtitle && String(subtitle).trim()) {
    blocks.unshift(String(subtitle).trim());
  }
  return blocks;
}

class MediumProvider extends social_abstract_1.SocialAbstract {
  constructor() {
    super(...arguments);
    this.maxConcurrentJob = 3;
    this.identifier = "medium";
    this.name = "Medium";
    this.isBetweenSteps = false;
    this.scopes = [];
    this.editor = "markdown";
    this.dto = medium_settings_dto_1.MediumSettingsDto;
    this.toolTip =
      "Medium retired new integration tokens. Connect with session cookies (sid, uid, xsrf) from a signed-in medium.com browser, same approach as Medium MCP.";
  }

  maxLength() {
    return 100000;
  }

  async customFields() {
    return [
      {
        key: "sid",
        label: "sid cookie",
        validation: `/^.{8,}$/`,
        type: "password",
        hint: "DevTools → Application → Cookies → medium.com → sid",
      },
      {
        key: "uid",
        label: "uid cookie",
        validation: `/^.{3,}$/`,
        type: "password",
        hint: "DevTools → Application → Cookies → .medium.com → uid",
      },
      {
        key: "xsrf",
        label: "xsrf cookie",
        validation: `/^.{3,}$/`,
        type: "password",
        hint: "DevTools → Application → Cookies → medium.com → xsrf",
      },
      {
        key: "cf_clearance",
        label: "cf_clearance cookie",
        validation: `/^.{10,}$/`,
        type: "password",
        hint: "Required for Cloudflare. DevTools → Cookies → .medium.com → cf_clearance",
      },
    ];
  }

  async generateAuthUrl() {
    const state = (0, make_secure_id_1.makeSecureId)(6);
    return {
      url: state,
      codeVerifier: (0, make_secure_id_1.makeSecureId)(10),
      state,
    };
  }

  async refreshToken() {
    return {
      refreshToken: "",
      expiresIn: 0,
      accessToken: "",
      id: "",
      name: "",
      picture: "",
      username: "",
    };
  }

  getCookies(integration, accessToken) {
    const tryParse = (raw) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(
          auth_service_1.AuthService.fixedDecryption(raw),
        );
        if (parsed?.sid && parsed?.uid && parsed?.xsrf && parsed?.cf_clearance) return parsed;
      } catch {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.sid && parsed?.uid && parsed?.xsrf && parsed?.cf_clearance) return parsed;
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

  async gql(cookies, operation, query, variables = {}) {
    const response = await fetch("https://medium.com/_/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "graphql-operation": operation,
        "x-xsrf-token": decodeURIComponent(cookies.xsrf),
        cookie: cookieHeader(cookies),
        origin: "https://medium.com",
        referer: "https://medium.com/",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        operationName: operation,
        query,
        variables,
      }),
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error("Medium refused the session. Refresh sid/uid/xsrf cookies.");
    }
    if (text.trimStart().startsWith("<")) {
      throw new Error(
        `Medium returned HTML for ${operation}. Session may need a fresh Cloudflare clearance.`,
      );
    }
    let parsed;
    try {
      const json = JSON.parse(text);
      parsed = Array.isArray(json) ? json[0] || {} : json;
    } catch {
      throw new Error(`${operation} returned unreadable JSON (HTTP ${response.status}).`);
    }
    if (parsed.errors?.length) {
      throw new Error(
        parsed.errors.map((error) => error.message || "GraphQL error").join("; "),
      );
    }
    if (response.status >= 400) {
      throw new Error(`${operation} failed with HTTP ${response.status}.`);
    }
    return parsed.data || {};
  }

  async saveDeltas(cookies, postId, title, paragraphs) {
    const deltas = [
      { type: 1, index: 0, paragraph: { type: 3, text: title, markups: [] } },
      ...paragraphs.map((text, offset) => ({
        type: 1,
        index: offset + 1,
        paragraph: { type: 1, text, markups: [] },
      })),
    ];
    const response = await fetch(`https://medium.com/p/${postId}/deltas`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-xsrf-token": decodeURIComponent(cookies.xsrf),
        cookie: cookieHeader(cookies),
        origin: "https://medium.com",
        referer: `https://medium.com/p/${postId}/edit`,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ baseRev: -1, rev: 0, deltas }),
    });
    let text = await response.text();
    const jsonStart = text.indexOf("{");
    if (text.startsWith("])}") && jsonStart >= 0) text = text.slice(jsonStart);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Draft save returned unreadable JSON (HTTP ${response.status}).`);
    }
    if (response.status >= 400 || body.success === false) {
      throw new Error(
        `Draft save failed (HTTP ${response.status}): ${JSON.stringify(body.error || body).slice(0, 500)}`,
      );
    }
    return body.payload || body;
  }

  async authenticate(params) {
    try {
      const body = JSON.parse(Buffer.from(params.code, "base64").toString());
      // Legacy Medium integration token path (no new tokens; still works if present).
      if (body.apiKey && !body.sid) {
        const {
          data: { name, id, imageUrl, username },
        } = await (
          await fetch("https://api.medium.com/v1/me", {
            headers: { Authorization: `Bearer ${body.apiKey}` },
          })
        ).json();
        return {
          refreshToken: "",
          expiresIn: HUNDRED_YEARS_SECONDS,
          accessToken: body.apiKey,
          id,
          name,
          picture: imageUrl || "",
          username,
        };
      }

      const cookies = {
        sid: String(body.sid || "").trim(),
        uid: String(body.uid || "").trim(),
        xsrf: String(body.xsrf || "").trim(),
        cf_clearance: String(body.cf_clearance || "").trim(),
        _cfuvid: String(body._cfuvid || "").trim(),
      };
      if (!cookies.sid || !cookies.uid || !cookies.xsrf || !cookies.cf_clearance) {
        return "Missing Medium session cookies (sid, uid, xsrf, cf_clearance)";
      }

      const data = await this.gql(cookies, "Viewer", VIEWER);
      const viewer = data.viewer;
      if (!viewer?.id) {
        return "Invalid Medium session cookies";
      }

      const encrypted = auth_service_1.AuthService.fixedEncryption(
        JSON.stringify(cookies),
      );
      return {
        refreshToken: "",
        expiresIn:
          (0, dayjs_1.default)().add(100, "years").unix() -
          (0, dayjs_1.default)().unix(),
        accessToken: encrypted,
        id: viewer.id,
        name: viewer.name || viewer.username || "Medium",
        picture: viewer.imageId
          ? `https://miro.medium.com/v2/resize:fill:128:128/${viewer.imageId}`
          : "",
        username: viewer.username || viewer.id,
      };
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid credentials";
    }
  }

  async publications(accessToken, _, id, integration) {
    const cookies = this.getCookies(integration, accessToken);
    if (!cookies) {
      // Legacy API-key integrations.
      try {
        const { data } = await (
          await fetch(`https://api.medium.com/v1/users/${id}/publications`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
        ).json();
        return data || [];
      } catch {
        return [];
      }
    }
    // Session/GraphQL path does not expose the old publications REST list.
    return [];
  }

  async post(id, accessToken, postDetails, integration) {
    const cookies = this.getCookies(integration, accessToken);
    const { settings } = postDetails?.[0] || { settings: {} };
    const message = postDetails?.[0]?.message || "";

    if (!cookies) {
      // Legacy REST publish for old API-key channels.
      const { data } = await (
        await fetch(
          settings?.publication
            ? `https://api.medium.com/v1/publications/${settings?.publication}/posts`
            : `https://api.medium.com/v1/users/${id}/posts`,
          {
            method: "POST",
            body: JSON.stringify({
              title: settings.title,
              contentFormat: "markdown",
              content: message,
              ...(settings.canonical
                ? { canonicalUrl: settings.canonical }
                : {}),
              ...(settings?.tags?.length
                ? { tags: settings.tags.map((tag) => tag.value) }
                : {}),
              publishStatus: settings?.publication ? "draft" : "public",
            }),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          },
        )
      ).json();
      return [
        {
          id: postDetails?.[0].id,
          status: "completed",
          postId: data.id,
          releaseURL: data.url,
        },
      ];
    }

    const title = String(settings?.title || "").trim();
    if (!title) {
      throw new Error("Medium requires a title");
    }
    const paragraphs = paragraphsFromText(message, settings?.subtitle);
    if (!paragraphs.length) {
      throw new Error("Medium requires a body");
    }

    const created = (
      await this.gql(cookies, "CreatePostMutation", CREATE_POST, { input: {} })
    ).createPost;
    if (!created?.id) {
      throw new Error("Medium createPost did not return a draft id");
    }
    await this.saveDeltas(cookies, created.id, title, paragraphs);
    const editUrl = `https://medium.com/p/${created.id}/edit`;
    return [
      {
        id: postDetails?.[0].id,
        status: "completed",
        postId: created.id,
        // Session GraphQL path creates a draft (same as Medium MCP).
        releaseURL: created.mediumUrl || editUrl,
      },
    ];
  }
}

exports.MediumProvider = MediumProvider;
tslib_1.__decorate([
    (0, tool_decorator_1.Tool)({ description: 'List of publications', dataSchema: [] }),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], MediumProvider.prototype, "publications", null);
