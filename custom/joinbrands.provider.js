"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JoinbrandsProvider = void 0;
const social_abstract_1 = require("../social.abstract");
const make_is_1 = require("../../services/make.is");
const JOINBRANDS_MCP = "https://api.joinbrands.com/mcp";
const HUNDRED_YEARS_SECONDS = 100 * 365 * 24 * 60 * 60;

function slug(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function mcpCall(token, method, params, id) {
    const response = await fetch(JOINBRANDS_MCP, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method,
            params,
        }),
    });
    if (!response.ok) {
        return null;
    }
    const text = await response.text();
    const payload = text.includes("\ndata:")
        ? text.split("\ndata:").pop()
        : text;
    return JSON.parse(payload);
}

class JoinbrandsProvider extends social_abstract_1.SocialAbstract {
    constructor() {
        super(...arguments);
        this.maxConcurrentJob = 1;
        this.identifier = "joinbrands";
        this.name = "JoinBrands";
        this.isBetweenSteps = false;
        this.scopes = [];
        this.editor = "normal";
        this.toolTip =
            "Creator campaigns for the connected brand. Postiz does not publish here.";
    }
    maxLength() {
        return 10000;
    }
    async customFields() {
        return [
            {
                key: "apiToken",
                label: "API token",
                validation: `/^.{20,}$/`,
                type: "password",
            },
        ];
    }
    async generateAuthUrl() {
        const state = (0, make_is_1.makeId)(6);
        return {
            url: state,
            codeVerifier: (0, make_is_1.makeId)(10),
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
    async authenticate(params) {
        try {
            const body = JSON.parse(Buffer.from(params.code, "base64").toString());
            const token = String(body.apiToken || "").trim();
            if (token.length < 20) {
                return "Invalid credentials";
            }
            const profile = await this.loadProfile(token);
            if (!profile) {
                return "Invalid credentials";
            }
            return {
                refreshToken: "",
                expiresIn: HUNDRED_YEARS_SECONDS,
                accessToken: token,
                id: `${profile.slug}-${profile.marketplace}`,
                name: profile.brandName,
                picture: `${process.env.FRONTEND_URL}/icons/platforms/joinbrands.png`,
                username: profile.brandName,
            };
        }
        catch (err) {
            return "Invalid credentials";
        }
    }
    async loadProfile(token) {
        const initialized = await mcpCall(token, "initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "postiz", version: "1.0.0" },
        }, 1);
        if (!initialized?.result?.serverInfo) {
            return null;
        }
        const campaigns = await mcpCall(token, "tools/call", {
            name: "list_campaigns",
            arguments: {
                marketplace: "us",
                rows: 1,
                page: 0,
            },
        }, 2);
        const content = campaigns?.result?.content?.[0]?.text;
        if (!content || campaigns?.result?.isError) {
            return null;
        }
        const parsed = JSON.parse(content);
        const row = Array.isArray(parsed?.rows) ? parsed.rows[0] : null;
        const brandName = String(row?.brand_name || "").trim();
        const marketplace = String(row?.marketplace_short_code || "us").trim();
        const brandSlug = slug(brandName);
        if (!brandSlug || !marketplace) {
            return null;
        }
        return { brandName, slug: brandSlug, marketplace };
    }
    // JoinBrands charges for creator invites and content actions.
    // This channel is a brand link, not a publishing target.
    async post() {
        throw new Error("JoinBrands is linked for Teavity campaigns. Postiz does not publish to JoinBrands.");
    }
}
exports.JoinbrandsProvider = JoinbrandsProvider;
