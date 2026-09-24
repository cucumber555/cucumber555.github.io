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

const MAX_PAGES = 100;          // 한 번 실행할 때 최대 페이지 수
const MAX_DEPTH = 2;            // 링크를 몇 단계까지 따라갈지
const REQUEST_DELAY = 1200;      // 요청 사이 대기 시간
const REQUEST_TIMEOUT = 10000;  // 요청 제한 시간
const MAX_CONTENT = 100000;     // 저장할 본문 최대 문자 수

// 처음 탐색을 시작할 사이트
const SEED_URLS = [
    "https://www.wikipedia.org/",
    "https://github.com/",
    "https://www.mozilla.org/",
    "https://www.nasa.gov/"
];

// 이미 방문한 URL
const visited = new Set();

// 크롤링 대기열
const queue = [];

// robots.txt 캐시
const robotsCache = new Map();


// ==============================
// 유틸
// ==============================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeUrl(url, baseUrl) {
    try {
        const parsed = new URL(url, baseUrl);

        // http/https만 허용
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return null;
        }

        // fragment 제거
        parsed.hash = "";

        // 너무 이상한 URL 제외
        if (parsed.username || parsed.password) {
            return null;
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

function isProbablyHtml(url, contentType = "") {
    const lower = url.toLowerCase();

    const blockedExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".svg",
        ".mp3",
        ".mp4",
        ".avi",
        ".mov",
        ".zip",
        ".rar",
        ".7z",
        ".pdf",
        ".exe",
        ".dmg",
        ".iso"
    ];

    if (blockedExtensions.some(ext => lower.split("?")[0].endsWith(ext))) {
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

async function getRobots(url) {
    const parsed = new URL(url);
    const origin = parsed.origin;

    if (robotsCache.has(origin)) {
        return robotsCache.get(origin);
    }

    const robotsUrl = `${origin}/robots.txt`;

    try {
        const response = await fetch(robotsUrl, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
            headers: {
                "User-Agent": "OSCADIA-Bot/1.0"
            }
        });

        let text = "";

        if (response.ok) {
            text = await response.text();
        }

        const robots = robotsParser(robotsUrl, text);

        robotsCache.set(origin, robots);

        return robots;

    } catch {
        // robots.txt를 가져오지 못했다고
        // 무조건 크롤링을 중단하지는 않음
        const robots = robotsParser(robotsUrl, "");

        robotsCache.set(origin, robots);

        return robots;
    }
}

async function allowedByRobots(url) {
    try {
        const robots = await getRobots(url);

        return robots.isAllowed(
            url,
            "OSCADIA-Bot"
        ) !== false;

    } catch {
        return false;
    }
}


// ==============================
// 페이지 가져오기
// ==============================

async function fetchPage(url) {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
            redirect: "follow",
            headers: {
                "User-Agent":
                    "OSCADIA-Bot/1.0 (+https://oscadia-api.onrender.com)"
            }
        });

        if (!response.ok) {
            console.log(
                `[SKIP] ${url} -> HTTP ${response.status}`
            );

            return null;
        }

        const contentType =
            response.headers.get("content-type") || "";

        if (!isProbablyHtml(url, contentType)) {
            return null;
        }

        const html = await response.text();

        return {
            html,
            contentType,
            finalUrl: response.url
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
    const $ = cheerio.load(html);

    // 불필요한 요소 제거
    $("script").remove();
    $("style").remove();
    $("noscript").remove();
    $("svg").remove();

    const title =
        $("title").first().text().trim() ||
        $("h1").first().text().trim() ||
        getDomain(url);

    const description =
        $('meta[name="description"]')
            .attr("content")
            ?.trim() || "";

    const content = $("body")
        .text(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_CONTENT);

    const links = [];

    $("a[href]").each((_, element) => {
        const href = $(element).attr("href");

        if (!href) {
            return;
        }

        const normalized = normalizeUrl(
            href,
            url
        );

        if (normalized) {
            links.push(normalized);
        }
    });

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

async function savePage(url, data) {
    const domain = getDomain(url);

    const query = `
        INSERT INTO pages (
            url,
            title,
            description,
            domain,
            content,
            last_crawled
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (url)
        DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            domain = EXCLUDED.domain,
            content = EXCLUDED.content,
            last_crawled = NOW()
    `;

    await pool.query(query, [
        url,
        data.title,
        data.description,
        domain,
        data.content
    ]);
}


// ==============================
// 크롤러
// ==============================

async function crawl() {
    console.log("================================");
    console.log("OSCADIA CRAWLER START");
    console.log("================================");

    // 시작 URL 등록
    for (const url of SEED_URLS) {
        queue.push({
            url,
            depth: 0
        });
    }

    let crawled = 0;

    while (
        queue.length > 0 &&
        crawled < MAX_PAGES
    ) {
        const item = queue.shift();

        if (!item) {
            break;
        }

        const {
            url,
            depth
        } = item;

        if (visited.has(url)) {
            continue;
        }

        if (depth > MAX_DEPTH) {
            continue;
        }

        visited.add(url);

        console.log(
            `[${crawled + 1}/${MAX_PAGES}] ${url}`
        );

        // robots.txt 확인
        const allowed =
            await allowedByRobots(url);

        if (!allowed) {
            console.log(
                `[ROBOTS] 접근 허용 안 됨: ${url}`
            );

            continue;
        }

        // 요청 간격
        await sleep(REQUEST_DELAY);

        const page =
            await fetchPage(url);

        if (!page) {
            continue;
        }

        const finalUrl =
            page.finalUrl || url;

        const data =
            parsePage(
                page.html,
                finalUrl
            );

        // 본문이 너무 없는 페이지는 제외
        if (
            data.content.length < 50 &&
            data.title.length < 2
        ) {
            console.log(
                `[SKIP] 내용이 너무 적음`
            );

            continue;
        }

        // DB 저장
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
                `[DB ERROR] ${error.message}`
            );
        }

        // 다음 페이지 추가
        if (depth < MAX_DEPTH) {
            for (const link of data.links) {

                if (
                    !visited.has(link) &&
                    !queue.some(
                        item => item.url === link
                    )
                ) {
                    queue.push({
                        url: link,
                        depth: depth + 1
                    });
                }
            }
        }
    }

    console.log("================================");
    console.log(
        `OSCADIA CRAWLER FINISHED: ${crawled} pages`
    );
    console.log("================================");

    await pool.end();
}


// ==============================
// 실행
// ==============================

crawl().catch(error => {
    console.error(
        "CRAWLER FAILED:",
        error
    );

    process.exit(1);
});