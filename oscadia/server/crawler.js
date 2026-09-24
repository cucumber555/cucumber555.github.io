import "dotenv/config";
import pg from "pg";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 2
});

// ==============================
// 설정
// ==============================

const MAX_PAGES = 2000;
const MAX_DEPTH = 3;

const REQUEST_DELAY = 1200;
const REQUEST_TIMEOUT = 10000;

const MAX_CONTENT = 100000;

// sitemap에서 한 번에 너무 많은 URL이 들어오는 것을 방지
const MAX_SITEMAP_URLS_PER_DOMAIN = 300;

// 처음 탐색을 시작할 사이트
const SEED_URLS = [
    "https://www.wikipedia.org/",
    "https://github.com/",
    "https://www.mozilla.org/",
    "https://www.nasa.gov/",

    "https://www.youtube.com/",
    "https://www.amazon.com/",
    "https://www.nationalgeographic.com/",
    "https://www.naver.com/",
    "https://www.google.com/",
    "https://www.bbc.com/",
    "https://www.cnn.com/",
    "https://www.reddit.com/",
    "https://stackoverflow.com/",
    "https://www.nytimes.com/",
    "https://www.theguardian.com/",
    "https://www.britannica.com/",
    "https://www.archive.org/",
    "https://www.w3.org/",
    "https://www.python.org/",
    "https://www.namu.wiki/"
];


// ==============================
// 유틸
// ==============================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function normalizeUrl(url, baseUrl) {
    try {
        const parsed = new URL(url, baseUrl);

        // HTTP / HTTPS만 허용
        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return null;
        }

        // 사용자명 / 비밀번호가 들어간 URL 제외
        if (parsed.username || parsed.password) {
            return null;
        }

        // fragment 제거
        parsed.hash = "";

        // 기본 포트 제거
        if (
            (parsed.protocol === "http:" && parsed.port === "80") ||
            (parsed.protocol === "https:" && parsed.port === "443")
        ) {
            parsed.port = "";
        }

        return parsed.href;

    } catch {
        return null;
    }
}


function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}


function getOrigin(url) {
    try {
        return new URL(url).origin;
    } catch {
        return "";
    }
}


function isProbablyHtml(url, contentType = "") {
    const lower = url.toLowerCase();

    const blockedExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".svg",
        ".ico",
        ".mp3",
        ".wav",
        ".ogg",
        ".mp4",
        ".webm",
        ".avi",
        ".mov",
        ".mkv",
        ".zip",
        ".rar",
        ".7z",
        ".tar",
        ".gz",
        ".pdf",
        ".exe",
        ".dmg",
        ".iso",
        ".apk",
        ".bin",
        ".css",
        ".js"
    ];

    const pathname = lower.split("?")[0];

    if (
        blockedExtensions.some(ext =>
            pathname.endsWith(ext)
        )
    ) {
        return false;
    }

    if (
        contentType &&
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml")
    ) {
        return false;
    }

    return true;
}


// ==============================
// robots.txt
// ==============================

const robotsCache = new Map();


async function getRobots(url) {
    let parsed;

    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    const origin = parsed.origin;

    if (robotsCache.has(origin)) {
        return robotsCache.get(origin);
    }

    const robotsUrl = `${origin}/robots.txt`;

    try {
        const response = await fetch(
            robotsUrl,
            {
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT
                ),
                headers: {
                    "User-Agent":
                        "OSCADIA-Bot/1.0"
                }
            }
        );

        let text = "";

        if (response.ok) {
            text = await response.text();
        }

        const robots =
            robotsParser(
                robotsUrl,
                text
            );

        robotsCache.set(
            origin,
            robots
        );

        return robots;

    } catch {
        const robots =
            robotsParser(
                robotsUrl,
                ""
            );

        robotsCache.set(
            origin,
            robots
        );

        return robots;
    }
}


async function allowedByRobots(url) {
    try {
        const robots =
            await getRobots(url);

        if (!robots) {
            return false;
        }

        return (
            robots.isAllowed(
                url,
                "OSCADIA-Bot"
            ) !== false
        );

    } catch {
        return false;
    }
}


// ==============================
// Sitemap
// ==============================

const sitemapCache = new Map();


async function getSitemapUrls(origin) {
    if (sitemapCache.has(origin)) {
        return sitemapCache.get(origin);
    }

    const discovered = new Set();

    try {
        const robotsUrl =
            `${origin}/robots.txt`;

        const response =
            await fetch(
                robotsUrl,
                {
                    signal:
                        AbortSignal.timeout(
                            REQUEST_TIMEOUT
                        ),
                    headers: {
                        "User-Agent":
                            "OSCADIA-Bot/1.0"
                    }
                }
            );

        let sitemapLocations = [];

        if (response.ok) {
            const text =
                await response.text();

            for (
                const line
                of text.split(/\r?\n/)
            ) {
                const trimmed =
                    line.trim();

                if (
                    trimmed
                        .toLowerCase()
                        .startsWith("sitemap:")
                ) {
                    const sitemap =
                        trimmed
                            .slice(8)
                            .trim();

                    if (sitemap) {
                        sitemapLocations.push(
                            sitemap
                        );
                    }
                }
            }
        }

        // robots.txt에 Sitemap이 없으면 기본 위치도 시도
        if (
            sitemapLocations.length === 0
        ) {
            sitemapLocations.push(
                `${origin}/sitemap.xml`
            );
        }

        for (
            const sitemapUrl
            of sitemapLocations
        ) {
            await collectSitemapUrls(
                sitemapUrl,
                discovered,
                new Set()
            );

            if (
                discovered.size >=
                MAX_SITEMAP_URLS_PER_DOMAIN
            ) {
                break;
            }
        }

    } catch {
        // sitemap이 없어도 계속 진행
    }

    const result =
        Array.from(discovered)
            .slice(
                0,
                MAX_SITEMAP_URLS_PER_DOMAIN
            );

    sitemapCache.set(
        origin,
        result
    );

    return result;
}


async function collectSitemapUrls(
    sitemapUrl,
    result,
    visitedSitemaps
) {
    if (
        result.size >=
        MAX_SITEMAP_URLS_PER_DOMAIN
    ) {
        return;
    }

    const normalized =
        normalizeUrl(
            sitemapUrl,
            sitemapUrl
        );

    if (!normalized) {
        return;
    }

    if (
        visitedSitemaps.has(
            normalized
        )
    ) {
        return;
    }

    visitedSitemaps.add(
        normalized
    );

    try {
        const response =
            await fetch(
                normalized,
                {
                    signal:
                        AbortSignal.timeout(
                            REQUEST_TIMEOUT
                        ),
                    headers: {
                        "User-Agent":
                            "OSCADIA-Bot/1.0"
                    }
                }
            );

        if (!response.ok) {
            return;
        }

        const text =
            await response.text();

        if (!text.includes("<")) {
            return;
        }

        const $ =
            cheerio.load(
                text,
                {
                    xmlMode: true
                }
            );

        // sitemap index
        $("sitemap > loc").each(
            (_, element) => {
                const loc =
                    $(element)
                        .text()
                        .trim();

                if (
                    loc &&
                    result.size <
                        MAX_SITEMAP_URLS_PER_DOMAIN
                ) {
                    collectSitemapUrls(
                        loc,
                        result,
                        visitedSitemaps
                    );
                }
            }
        );

        // 일반 sitemap
        $("url > loc").each(
            (_, element) => {
                if (
                    result.size >=
                    MAX_SITEMAP_URLS_PER_DOMAIN
                ) {
                    return;
                }

                const loc =
                    $(element)
                        .text()
                        .trim();

                const url =
                    normalizeUrl(
                        loc,
                        normalized
                    );

                if (url) {
                    result.add(url);
                }
            }
        );

    } catch {
        // sitemap 오류 무시
    }
}


// ==============================
// 페이지 가져오기
// ==============================

async function fetchPage(url) {
    try {
        const response =
            await fetch(
                url,
                {
                    signal:
                        AbortSignal.timeout(
                            REQUEST_TIMEOUT
                        ),
                    redirect: "follow",
                    headers: {
                        "User-Agent":
                            "OSCADIA-Bot/1.0 (+https://oscadia-api.onrender.com)",
                        "Accept":
                            "text/html,application/xhtml+xml"
                    }
                }
            );

        if (!response.ok) {
            console.log(
                `[SKIP] ${url} -> HTTP ${response.status}`
            );

            return null;
        }

        const contentType =
            response.headers.get(
                "content-type"
            ) || "";

        if (
            !isProbablyHtml(
                url,
                contentType
            )
        ) {
            return null;
        }

        const html =
            await response.text();

        return {
            html,
            contentType,
            finalUrl:
                response.url
        };

    } catch (error) {
        console.log(
            `[ERROR] ${url}: ${error.message}`
        );

        return null;
    }
}


// ==============================
// HTML 분석
// ==============================

function parsePage(html, url) {
    const $ =
        cheerio.load(html);

    // 불필요한 요소 제거
    $("script").remove();
    $("style").remove();
    $("noscript").remove();
    $("svg").remove();
    $("iframe").remove();

    const title =
        $("title")
            .first()
            .text()
            .trim() ||
        $("h1")
            .first()
            .text()
            .trim() ||
        getDomain(url);

    const description =
        $('meta[name="description"]')
            .attr("content")
            ?.trim() || "";

    const content =
        $("body")
            .text()
            .replace(/\s+/g, " ")
            .trim()
            .slice(
                0,
                MAX_CONTENT
            );

    const links = [];

    $("a[href]").each(
        (_, element) => {
            const href =
                $(element)
                    .attr("href");

            if (!href) {
                return;
            }

            const normalized =
                normalizeUrl(
                    href,
                    url
                );

            if (normalized) {
                links.push(
                    normalized
                );
            }
        }
    );

    return {
        title,
        description,
        content,
        links
    };
}


// ==============================
// DB 저장
// ==============================

async function savePage(
    url,
    data
) {
    const domain =
        getDomain(url);

    const query = `
        INSERT INTO pages (
            url,
            title,
            description,
            domain,
            content,
            last_crawled
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            NOW()
        )
        ON CONFLICT (url)
        DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            domain = EXCLUDED.domain,
            content = EXCLUDED.content,
            last_crawled = NOW()
    `;

    await pool.query(
        query,
        [
            url,
            data.title,
            data.description,
            domain,
            data.content
        ]
    );
}


// ==============================
// 크롤러
// ==============================

async function crawl() {
    console.log(
        "================================"
    );

    console.log(
        "OSCADIA CRAWLER START"
    );

    console.log(
        "================================"
    );

    // 실행마다 새 큐 / 방문 목록
    const visited =
        new Set();

    const queue = [];

    // 시작 URL 등록
    for (
        const url
        of SEED_URLS
    ) {
        const normalized =
            normalizeUrl(
                url,
                url
            );

        if (normalized) {
            queue.push({
                url: normalized,
                depth: 0,
                source: "seed"
            });
        }
    }

    let crawled = 0;

    const discoveredDomains =
        new Set();

    while (
        queue.length > 0 &&
        crawled < MAX_PAGES
    ) {
        const item =
            queue.shift();

        if (!item) {
            break;
        }

        const {
            url,
            depth,
            source
        } = item;

        if (
            visited.has(url)
        ) {
            continue;
        }

        if (
            depth > MAX_DEPTH
        ) {
            continue;
        }

        visited.add(url);

        console.log(
            `[${crawled + 1}/${MAX_PAGES}] ${url}`
        );

        // ==========================
        // robots.txt
        // ==========================

        const allowed =
            await allowedByRobots(
                url
            );

        if (!allowed) {
            console.log(
                `[ROBOTS] 접근 허용 안 됨: ${url}`
            );

            continue;
        }

        // ==========================
        // 새로운 도메인 발견
        // ==========================

        const origin =
            getOrigin(url);

        if (
            origin &&
            !discoveredDomains.has(
                origin
            )
        ) {
            discoveredDomains.add(
                origin
            );

            console.log(
                `[DISCOVERED DOMAIN] ${origin}`
            );

            // sitemap 자동 발견
            const sitemapUrls =
                await getSitemapUrls(
                    origin
                );

            if (
                sitemapUrls.length > 0
            ) {
                console.log(
                    `[SITEMAP] ${origin} -> ${sitemapUrls.length} URLs`
                );

                for (
                    const sitemapUrl
                    of sitemapUrls
                ) {
                    if (
                        !visited.has(
                            sitemapUrl
                        ) &&
                        !queue.some(
                            item =>
                                item.url ===
                                sitemapUrl
                        )
                    ) {
                        queue.push({
                            url:
                                sitemapUrl,
                            depth:
                                Math.min(
                                    depth + 1,
                                    MAX_DEPTH
                                ),
                            source:
                                "sitemap"
                        });
                    }

                    if (
                        queue.length >=
                        MAX_PAGES * 3
                    ) {
                        break;
                    }
                }
            }
        }

        // ==========================
        // 요청 간격
        // ==========================

        await sleep(
            REQUEST_DELAY
        );

        // ==========================
        // 페이지 가져오기
        // ==========================

        const page =
            await fetchPage(
                url
            );

        if (!page) {
            continue;
        }

        const finalUrl =
            page.finalUrl ||
            url;

        // redirect된 URL도 방문 처리
        visited.add(
            finalUrl
        );

        // ==========================
        // HTML 분석
        // ==========================

        const data =
            parsePage(
                page.html,
                finalUrl
            );

        // 본문이 너무 없는 페이지 제외
        if (
            data.content.length < 50 &&
            data.title.length < 2
        ) {
            console.log(
                `[SKIP] 내용이 너무 적음`
            );

            continue;
        }

        // ==========================
        // DB 저장
        // ==========================

        try {
            await savePage(
                finalUrl,
                data
            );

            console.log(
                `[SAVED] ${data.title}`
            );

            crawled++;

        } catch (error) {
            console.error(
                "[DB ERROR]"
            );

            console.error(
                "message:",
                error.message
            );

            console.error(
                "code:",
                error.code
            );

            console.error(
                "detail:",
                error.detail
            );

            console.error(
                "hint:",
                error.hint
            );

            // DB 오류가 나도
            // 크롤러 전체는 계속 진행
        }

        // ==========================
        // 페이지에서 링크 발견
        // ==========================

        if (
            depth < MAX_DEPTH
        ) {
            for (
                const link
                of data.links
            ) {
                if (
                    visited.has(link)
                ) {
                    continue;
                }

                if (
                    queue.some(
                        item =>
                            item.url ===
                            link
                    )
                ) {
                    continue;
                }

                const linkDomain =
                    getDomain(link);

                // 외부 도메인도 허용
                if (
                    linkDomain &&
                    linkDomain !==
                        getDomain(finalUrl)
                ) {
                    console.log(
                        `[NEW DOMAIN] ${linkDomain}`
                    );
                }

                queue.push({
                    url: link,
                    depth: depth + 1,
                    source: "link"
                });

                // 큐가 지나치게 커지는 것 방지
                if (
                    queue.length >=
                    MAX_PAGES * 3
                ) {
                    break;
                }
            }
        }
    }

    console.log(
        "================================"
    );

    console.log(
        `OSCADIA CRAWLER FINISHED: ${crawled} pages`
    );

    console.log(
        `DISCOVERED DOMAINS: ${discoveredDomains.size}`
    );

    console.log(
        `REMAINING QUEUE: ${queue.length}`
    );

    console.log(
        "================================"
    );
}


// ==============================
// 실행
// ==============================

export {
    crawl
};


if (
    process.argv[1] ===
    new URL(
        import.meta.url
    ).pathname
) {
    crawl().catch(
        error => {
            console.error(
                "CRAWLER FAILED:",
                error
            );

            process.exit(1);
        }
    );
}