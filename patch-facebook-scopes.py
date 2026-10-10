import shutil
from pathlib import Path

GMB_FILES = [
    Path("/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/gmb.provider.js"),
    Path("/app/apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/social/gmb.provider.js"),
]

IG_FILES = [
    Path("/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/instagram.provider.js"),
    Path("/app/apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/social/instagram.provider.js"),
]
IG_OLD = """            'instagram_basic',
            'pages_show_list',
            'pages_read_engagement',
            'business_management',
            'instagram_content_publish',
            'instagram_manage_comments',
            'instagram_manage_insights',"""
IG_NEW = """            'pages_show_list',
            'pages_read_engagement',
            'business_management',"""


def patch_instagram():
    for path in IG_FILES:
        if not path.exists():
            print("missing", path)
            continue
        text = path.read_text()
        if IG_OLD not in text:
            print("ig-no-match-or-already-patched", path)
            continue
        path.write_text(text.replace(IG_OLD, IG_NEW, 1))
        print("patched-instagram", path)


FB_FILES = [
    Path("/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/facebook.provider.js"),
    Path("/app/apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/social/facebook.provider.js"),
]
NGINX = Path("/etc/nginx/nginx.conf")
GMB_REDIRECT_MARKER = "location /integrations/social/youtube"


def patch_facebook():
    old = "            'pages_read_engagement',\n            'read_insights',"
    new = "            'pages_read_engagement',"
    for path in FB_FILES:
        if not path.exists():
            print("missing", path)
            continue
        text = path.read_text()
        if old not in text:
            print("no-match-or-already-patched", path)
            continue
        path.write_text(text.replace(old, new, 1))
        print("patched-facebook", path)


def patch_gmb():
    # Existing Google web client already allows /integrations/social/youtube
    # (Google login works). It does not allow /gmb, which causes
    # redirect_uri_mismatch. Send GMB OAuth to the youtube callback, then
    # nginx rewrites back to /gmb when state starts with gmb.
    for path in GMB_FILES:
        if not path.exists():
            print("missing", path)
            continue
        text = path.read_text()
        original = text
        text = text.replace(
            "${process.env.FRONTEND_URL}/integrations/social/gmb",
            "${process.env.FRONTEND_URL}/integrations/social/youtube",
        )
        text = text.replace(
            "        const state = (0, make_is_1.makeId)(7);",
            "        const state = 'gmb.' + (0, make_is_1.makeId)(7);",
        )
        if text == original:
            print("gmb-no-change", path)
        else:
            path.write_text(text)
            print("patched-gmb", path)


def patch_nginx():
    if not NGINX.exists():
        print("missing nginx.conf")
        return
    text = NGINX.read_text()
    if GMB_REDIRECT_MARKER in text:
        print("nginx-already-patched")
        return
    needle = "        location / {"
    insert = """        location /integrations/social/youtube {
            if ($arg_state ~ ^gmb\\.) {
                rewrite ^ /integrations/social/gmb last;
            }
            proxy_pass http://localhost:4200;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Reload $http_reload;
            proxy_set_header Onboarding $http_onboarding;
            proxy_set_header Activate $http_activate;
            proxy_set_header Auth $http_auth;
            proxy_set_header Showorg $http_showorg;
            proxy_set_header Impersonate $http_impersonate;
            proxy_set_header Accept-Language $http_accept_language;
            proxy_set_header i18next $http_i18next;
        }

"""
    if needle not in text:
        print("nginx-needle-missing")
        return
    NGINX.write_text(text.replace(needle, insert + needle, 1))
    print("patched-nginx")



GOOGLE_PROVIDER = Path("/app/apps/backend/dist/apps/backend/src/services/auth/providers/google.provider.js")
PROXY_SRC = Path("/app/apps/frontend/src/proxy.ts")
PROXY_BUNDLE = Path("/app/apps/frontend/.next/server/chunks/[root-of-the-server]__0-e5mkf._.js")
REGISTER_SRC = Path("/app/apps/frontend/src/components/auth/register.tsx")
REGISTER_BUNDLE = Path("/app/apps/frontend/.next/static/chunks/0x39l~xt6gp1k.js")


def patch_google_get_token():
    if not GOOGLE_PROVIDER.exists():
        print("missing google.provider")
        return
    text = GOOGLE_PROVIDER.read_text()
    old = """    async getToken(code, redirectUri) {
        const client = makeClient(redirectUri || defaultRedirect());
        const { tokens } = await client.getToken(code);
        return tokens.access_token;
    }"""
    new = """    async getToken(code, redirectUri) {
        // Login codes are minted for /integrations/social/youtube.
        // Ignore callback redirect_uri (often /auth after proxy rewrite).
        const uri = defaultRedirect();
        const client = makeClient(uri);
        const { tokens } = await client.getToken({ code, redirect_uri: uri });
        return tokens.access_token;
    }"""
    if old not in text:
        print("google-getToken-no-match-or-already-patched")
        return
    GOOGLE_PROVIDER.write_text(text.replace(old, new, 1))
    print("patched-google-getToken")


def patch_proxy_src():
    if not PROXY_SRC.exists():
        print("missing proxy.ts")
        return
    text = PROXY_SRC.read_text()
    old = """    const providers = ['google', 'settings'];
    const findIndex = providers.find((p) => nextUrl.href.indexOf(p) > -1);"""
    new = """    // Match pathname only. href matching treats iss=accounts.google.com as GOOGLE
    // and crosses GENERIC (/settings or /auth) with YouTube token exchange.
    const findIndex =
      nextUrl.pathname.startsWith('/integrations/social/youtube') &&
      nextUrl.searchParams.get('state') === 'login'
        ? 'google'
        : nextUrl.pathname.startsWith('/settings')
          ? 'settings'
          : undefined;"""
    if old not in text:
        print("proxy-src-no-match-or-already-patched")
        return
    PROXY_SRC.write_text(text.replace(old, new, 1))
    print("patched-proxy-src")


def patch_proxy_bundle():
    if not PROXY_BUNDLE.exists():
        print("missing proxy bundle")
        return
    text = PROXY_BUNDLE.read_text()
    old = 'let e=["google","settings"].find(e=>t.href.indexOf(e)>-1),a=e?(s.indexOf("?")>-1?"&":"?")+`provider=${("settings"===e?process.env.POSTIZ_GENERIC_OAUTH?"generic":"github":e).toUpperCase()}`:"";'
    new = 'let e=t.pathname.startsWith("/integrations/social/youtube")&&"login"===t.searchParams.get("state")?"google":t.pathname.startsWith("/settings")?"settings":void 0,a=e?(s.indexOf("?")>-1?"&":"?")+`provider=${("settings"===e?process.env.POSTIZ_GENERIC_OAUTH?"generic":"github":e).toUpperCase()}`:"";'
    if old not in text:
        print("proxy-bundle-no-match-or-already-patched")
        return
    PROXY_BUNDLE.write_text(text.replace(old, new, 1))
    print("patched-proxy-bundle")


def patch_register_src():
    if not REGISTER_SRC.exists():
        print("missing register.tsx")
        return
    text = REGISTER_SRC.read_text()
    old = """    const { token } = await (
      await fetch(`/auth/oauth/${provider?.toUpperCase() || 'LOCAL'}/exists`, {
        method: 'POST',
        body: JSON.stringify({
          code,
        }),
      })
    ).json();
    if (token) {
      setCode(token);
      setShow(true);
    }"""
    new = """    const data = await (
      await fetch(`/auth/oauth/${provider?.toUpperCase() || 'LOCAL'}/exists`, {
        method: 'POST',
        body: JSON.stringify({
          code,
          redirect_uri: `${window.location.origin}/integrations/social/youtube`,
        }),
      })
    ).json();
    if (data?.login) {
      window.location.href = '/launches';
      return;
    }
    if (data?.token) {
      setCode(data.token);
      setShow(true);
    }"""
    if old not in text:
        print("register-src-no-match-or-already-patched")
        return
    REGISTER_SRC.write_text(text.replace(old, new, 1))
    print("patched-register-src")


def patch_register_bundle():
    if not REGISTER_BUNDLE.exists():
        print("missing register bundle")
        return
    text = REGISTER_BUNDLE.read_text()
    old = 'let{token:e}=await (await r(`/auth/oauth/${a?.toUpperCase()||"LOCAL"}/exists`,{method:"POST",body:JSON.stringify({code:i})})).json();e&&(o(e),u(!0))'
    new = 'let e=await (await r(`/auth/oauth/${a?.toUpperCase()||"LOCAL"}/exists`,{method:"POST",body:JSON.stringify({code:i,redirect_uri:window.location.origin+"/integrations/social/youtube"})})).json();if(e.login){window.location.href="/launches";return}e.token&&(o(e.token),u(!0))'
    if old not in text:
        print("register-bundle-no-match-or-already-patched")
        return
    REGISTER_BUNDLE.write_text(text.replace(old, new, 1))
    print("patched-register-bundle")

MANAGER_FILES = [
    Path("/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/integration.manager.js"),
    Path("/app/apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/integration.manager.js"),
]
SOCIAL_DIRS = [
    Path("/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/social"),
    Path("/app/apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/social"),
]
JOINBRANDS_PROVIDER = Path("/custom/joinbrands.provider.js")
JOINBRANDS_ICON = Path("/custom/joinbrands.png")
TUMBLR_REQUIRE = 'const tumblr_provider_1 = require("./social/tumblr.provider");\n'
JOINBRANDS_REQUIRE = 'const joinbrands_provider_1 = require("./social/joinbrands.provider");\n'
TUMBLR_NEW = "    new tumblr_provider_1.TumblrProvider(),\n"
JOINBRANDS_NEW = "    new joinbrands_provider_1.JoinbrandsProvider(),\n"



MEDIUM_PROVIDER = Path("/custom/medium.provider.js")
MEDIUM_FILES = [
    Path("/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/medium.provider.js"),
    Path("/app/apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/social/medium.provider.js"),
]


def patch_medium():
    # Overwrite stock API-key Medium provider with session/GraphQL (Medium MCP style).
    if not MEDIUM_PROVIDER.exists():
        print("missing medium provider")
        return
    for path in MEDIUM_FILES:
        if not path.parent.exists():
            print("missing", path.parent)
            continue
        shutil.copy(MEDIUM_PROVIDER, path)
        print("copied-medium-provider", path)


def patch_joinbrands():
    if not JOINBRANDS_PROVIDER.exists():
        print("missing joinbrands provider")
        return
    for directory in SOCIAL_DIRS:
        if not directory.exists():
            print("missing", directory)
            continue
        shutil.copy(JOINBRANDS_PROVIDER, directory / "joinbrands.provider.js")
        print("copied-joinbrands-provider", directory)
    for path in MANAGER_FILES:
        if not path.exists():
            print("missing", path)
            continue
        text = path.read_text()
        original = text
        if JOINBRANDS_REQUIRE not in text:
            if TUMBLR_REQUIRE not in text:
                print("joinbrands-require-needle-missing", path)
                continue
            text = text.replace(TUMBLR_REQUIRE, TUMBLR_REQUIRE + JOINBRANDS_REQUIRE, 1)
        if "new joinbrands_provider_1.JoinbrandsProvider()" not in text:
            if TUMBLR_NEW not in text:
                print("joinbrands-list-needle-missing", path)
                continue
            text = text.replace(TUMBLR_NEW, TUMBLR_NEW + JOINBRANDS_NEW, 1)
        if text != original:
            path.write_text(text)
            print("patched-joinbrands-manager", path)
        else:
            print("joinbrands-manager-already-patched", path)
    if not JOINBRANDS_ICON.exists():
        print("missing joinbrands icon")
        return
    copied = 0
    for icon in Path("/app").rglob("facebook.png"):
        if "platforms" not in icon.parts:
            continue
        shutil.copy(JOINBRANDS_ICON, icon.with_name("joinbrands.png"))
        copied += 1
    print("copied-joinbrands-icon", copied)


patch_facebook()
patch_gmb()
patch_nginx()
# patch_instagram()  # disabled: app 2155662342022171 has instagram_* permissions enabled
patch_google_get_token()
patch_proxy_src()
patch_proxy_bundle()
patch_register_src()
patch_register_bundle()
patch_joinbrands()
patch_medium()

def patch_tiktok():
    files = [
        Path("/app/apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/tiktok.provider.js"),
        Path("/app/apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/social/tiktok.provider.js"),
    ]
    old_scopes = """        this.scopes = [
            'video.list',
            'user.info.basic',
            'video.publish',
            'video.upload',
            'user.info.profile',
            'user.info.stats',
        ];"""
    new_scopes = """        this.scopes = [
            'user.info.basic',
            'video.publish',
            'video.upload',
        ];"""
    old_fields = "fields=open_id,avatar_url,display_name,union_id,username"
    new_fields = "fields=open_id,avatar_url,display_name"
    for path in files:
        if not path.exists():
            print("missing", path)
            continue
        text = path.read_text()
        original = text
        if old_scopes in text:
            text = text.replace(old_scopes, new_scopes, 1)
        elif new_scopes not in text:
            print("tiktok-scopes-needle-missing", path)
            continue
        text = text.replace(old_fields, new_fields)
        if text != original:
            path.write_text(text)
            print("patched-tiktok", path)
        else:
            print("tiktok-already-patched", path)


patch_tiktok()
