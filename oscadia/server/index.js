import "dotenv/config";
import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

import { crawl } from "./crawler.js";

import {
    verifySMTP,
    getMyOSmail,
    createOSmailProfile,
    sendInternalMail,
    sendExternalMail,
    getEmails,
    markAsRead,
    deleteEmail,
    restoreEmail
} from "./osmail.js";

// ========================================
// 기본 설정
// ========================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const app = express();

const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ========================================
// PostgreSQL
// ========================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    },

    max: 2
});

// ========================================
// 서버 상태
// ========================================

let crawlerRunning = false;
let lastCrawlerStart = null;
let lastCrawlerFinish = null;
let lastCrawlerError = null;

// ========================================
// 검색어 별칭
// ========================================

const SEARCH_ALIASES = {
    "구글": ["google", "google.com"],
    "google": ["google", "google.com"],

    "네이버": ["naver", "naver.com"],
    "naver": ["naver", "naver.com"],

    "다음": ["daum", "daum.net"],
    "daum": ["daum", "daum.net"],

    "유튜브": ["youtube", "youtube.com"],
    "youtube": ["youtube", "youtube.com"],

    "깃허브": ["github", "github.com"],
    "github": ["github", "github.com"],

    "위키백과": ["wikipedia", "wikipedia.org"],
    "위키피디아": ["wikipedia", "wikipedia.org"],
    "wikipedia": ["wikipedia", "wikipedia.org"],

    "모질라": ["mozilla", "mozilla.org"],
    "mozilla": ["mozilla", "mozilla.org"],

    "나사": ["nasa", "nasa.gov"],
    "nasa": ["nasa", "nasa.gov"],

    "아마존": ["amazon", "amazon.com"],
    "amazon": ["amazon", "amazon.com"],

    "비비씨": ["bbc", "bbc.com"],
    "bbc": ["bbc", "bbc.com"],

    "씨엔엔": ["cnn", "cnn.com"],
    "cnn": ["cnn", "cnn.com"],

    "레딧": ["reddit", "reddit.com"],
    "reddit": ["reddit", "reddit.com"],

    "스택오버플로": ["stackoverflow", "stackoverflow.com"],
    "스택오버플로우": ["stackoverflow", "stackoverflow.com"],
    "stackoverflow": ["stackoverflow", "stackoverflow.com"],

    "뉴욕타임스": ["nytimes", "nytimes.com"],
    "뉴욕 타임스": ["nytimes", "nytimes.com"],
    "nytimes": ["nytimes", "nytimes.com"],

    "가디언": ["guardian", "theguardian.com"],
    "guardian": ["guardian", "theguardian.com"],

    "브리태니커": ["britannica", "britannica.com"],
    "britannica": ["britannica", "britannica.com"],

    "인터넷 아카이브": ["archive", "archive.org"],
    "인터넷아카이브": ["archive", "archive.org"],
    "archive": ["archive", "archive.org"],

    "w3c": ["w3c", "w3.org"],
    "월드와이드웹컨소시엄": ["w3c", "w3.org"],

    "파이썬": ["python", "python.org"],
    "python": ["python", "python.org"],

    "나무위키": ["namu", "namu.wiki"],
    "namuwiki": ["namu", "namu.wiki"]
};

// ========================================
// 관련 검색어
// ========================================

const RELATED_TERMS = {
    "검색": [
        "search",
        "검색엔진",
        "search engine",
        "웹검색",
        "web search"
    ],

    "검색엔진": [
        "search",
        "search engine",
        "검색"
    ],

    "동영상": [
        "video",
        "videos",
        "youtube",
        "streaming"
    ],

    "영상": [
        "video",
        "videos",
        "youtube",
        "streaming"
    ],

    "뉴스": [
        "news",
        "breaking news",
        "신문"
    ],

    "쇼핑": [
        "shopping",
        "shop",
        "store",
        "products",
        "상품"
    ],

    "온라인 쇼핑": [
        "shopping",
        "shop",
        "store",
        "products"
    ],

    "백과사전": [
        "encyclopedia",
        "wikipedia",
        "knowledge",
        "reference"
    ],

    "위키": [
        "wiki",
        "wikipedia",
        "encyclopedia"
    ],

    "개발": [
        "developer",
        "development",
        "programming",
        "code",
        "software"
    ],

    "프로그래밍": [
        "programming",
        "developer",
        "code",
        "software"
    ],

    "코딩": [
        "coding",
        "programming",
        "developer",
        "code"
    ],

    "우주": [
        "space",
        "nasa",
        "astronomy",
        "science"
    ],

    "과학": [
        "science",
        "research",
        "technology"
    ],

    "소셜": [
        "social",
        "community",
        "forum",
        "discussion"
    ],

    "커뮤니티": [
        "community",
        "forum",
        "discussion",
        "social"
    ]
};

// ========================================
// 검색 함수
// ========================================

function normalizeSearchQuery(query) {
    return String(query || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function tokenizeQuery(query) {
    return normalizeSearchQuery(query)
        .split(/[\s,./!?()[\]{}:;|]+/)
        .map(word => word.trim())
        .filter(Boolean);
}

function getSearchTerms(query) {
    const normalized = normalizeSearchQuery(query);

    const terms = new Set();

    if (normalized) {
        terms.add(normalized);
    }

    for (const token of tokenizeQuery(normalized)) {
        terms.add(token);
    }

    const aliases = SEARCH_ALIASES[normalized];

    if (aliases) {
        for (const alias of aliases) {
            terms.add(alias.toLowerCase());
        }
    }

    const related = RELATED_TERMS[normalized];

    if (related) {
        for (const term of related) {
            terms.add(term.toLowerCase());
        }
    }

    return [...terms];
}

function getDomainFromUrl(url) {
    try {
        return new URL(url)
            .hostname
            .toLowerCase()
            .replace(/^www\./, "");
    } catch {
        return "";
    }
}

// ========================================
// 검색 API
// ========================================

app.get("/api/search", async (req, res) => {
    const originalQuery = String(req.query.q || "").trim();

    if (!originalQuery) {
        return res.json({
            ok: true,
            count: 0,
            results: []
        });
    }

    const query = normalizeSearchQuery(originalQuery);
    const terms = getSearchTerms(query).slice(0, 30);

    try {
        const conditions = [];
        const values = [];

        for (let i = 0; i < terms.length; i++) {
            const p = `$${i + 1}`;
            values.push(terms[i]);

            conditions.push(`
                (
                    LOWER(COALESCE(title, '')) LIKE '%' || LOWER(${p}) || '%'
                    OR LOWER(COALESCE(description, '')) LIKE '%' || LOWER(${p}) || '%'
                    OR LOWER(COALESCE(keywords, '')) LIKE '%' || LOWER(${p}) || '%'
                    OR LOWER(COALESCE(content, '')) LIKE '%' || LOWER(${p}) || '%'
                    OR LOWER(COALESCE(url, '')) LIKE '%' || LOWER(${p}) || '%'
                    OR LOWER(COALESCE(domain, '')) LIKE '%' || LOWER(${p}) || '%'
                )
            `);
        }

        if (!conditions.length) {
            return res.json({
                ok: true,
                query: originalQuery,
                count: 0,
                results: []
            });
        }

        const scoreParts = terms.map((term, i) => {
            const p = `$${i + 1}`;

            return `
                (
                    CASE
                        WHEN LOWER(COALESCE(title, ''))
                            LIKE '%' || LOWER(${p}) || '%'
                        THEN 100
                        ELSE 0
                    END
                    +
                    CASE
                        WHEN LOWER(COALESCE(keywords, ''))
                            LIKE '%' || LOWER(${p}) || '%'
                        THEN 60
                        ELSE 0
                    END
                    +
                    CASE
                        WHEN LOWER(COALESCE(description, ''))
                            LIKE '%' || LOWER(${p}) || '%'
                        THEN 45
                        ELSE 0
                    END
                    +
                    CASE
                        WHEN LOWER(COALESCE(domain, ''))
                            LIKE '%' || LOWER(${p}) || '%'
                        THEN 40
                        ELSE 0
                    END
                    +
                    CASE
                        WHEN LOWER(COALESCE(url, ''))
                            LIKE '%' || LOWER(${p}) || '%'
                        THEN 30
                        ELSE 0
                    END
                    +
                    CASE
                        WHEN LOWER(COALESCE(content, ''))
                            LIKE '%' || LOWER(${p}) || '%'
                        THEN 10
                        ELSE 0
                    END
                )
            `;
        });

        const sql = `
            SELECT
                id,
                url,
                title,
                description,
                domain,
                keywords,
                last_crawled,
                (${scoreParts.join(" + ")}) AS relevance_score
            FROM pages
            WHERE ${conditions.join(" OR ")}
            ORDER BY relevance_score DESC, last_crawled DESC
            LIMIT 50
        `;

        const result = await pool.query(sql, values);

        const results = result.rows.map(row => {
            const title = String(row.title || "").toLowerCase();
            const description = String(row.description || "").toLowerCase();
            const keywords = String(row.keywords || "").toLowerCase();
            const content = String(row.content || "").toLowerCase();
            const domain = String(row.domain || "").toLowerCase();
            const url = String(row.url || "").toLowerCase();

            let score = Number(row.relevance_score || 0);

            if (title.includes(query)) score += 250;
            if (keywords.includes(query)) score += 150;
            if (description.includes(query)) score += 100;

            let aliasMatch = false;

            const aliases = SEARCH_ALIASES[query];

            if (aliases) {
                aliasMatch = aliases.some(alias => {
                    const a = alias.toLowerCase();

                    return (
                        domain.includes(a) ||
                        url.includes(a) ||
                        title.includes(a) ||
                        keywords.includes(a)
                    );
                });

                if (aliasMatch) {
                    score += 500;
                }
            }

            let relatedMatch = false;

            const related = RELATED_TERMS[query];

            if (related) {
                relatedMatch = related.some(term => {
                    const t = term.toLowerCase();

                    return (
                        keywords.includes(t) ||
                        title.includes(t) ||
                        description.includes(t) ||
                        content.includes(t)
                    );
                });

                if (relatedMatch) {
                    score += 180;
                }
            }

            return {
                id: row.id,
                url: row.url,
                title: row.title || "제목 없음",
                description: row.description || "",
                domain:
                    row.domain ||
                    getDomainFromUrl(row.url),
                keywords: row.keywords || "",
                last_crawled: row.last_crawled,
                rank: score,
                alias_match: aliasMatch,
                related_match: relatedMatch
            };
        });

        results.sort((a, b) => {
            if (a.alias_match !== b.alias_match) {
                return a.alias_match ? -1 : 1;
            }

            if (a.related_match !== b.related_match) {
                return a.related_match ? -1 : 1;
            }

            return Number(b.rank) - Number(a.rank);
        });

        const uniqueResults = [];
        const seenUrls = new Set();

        for (const result of results) {
            const normalizedUrl = String(result.url || "")
                .toLowerCase()
                .replace(/\/+$/, "");

            if (seenUrls.has(normalizedUrl)) {
                continue;
            }

            seenUrls.add(normalizedUrl);
            uniqueResults.push(result);

            if (uniqueResults.length >= 50) {
                break;
            }
        }

        return res.json({
            ok: true,
            query: originalQuery,
            searchTerms: terms,
            count: uniqueResults.length,
            results: uniqueResults
        });

    } catch (error) {
        console.error("[SEARCH ERROR]", error);

        return res.status(500).json({
            ok: false,
            error: "검색 중 오류가 발생했습니다."
        });
    }
});

// ========================================
// Health Check
// ========================================

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            ok: true,
            database: "connected",
            crawler: "enabled",
            service: "OSCADIA"
        });

    } catch (error) {
        console.error("[HEALTH ERROR]", error);

        res.status(500).json({
            ok: false,
            database: "disconnected",
            error: error.message
        });
    }
});

// ========================================
// Crawler
// ========================================

async function runCrawler() {
    if (crawlerRunning) {
        console.log("[CRAWLER] Already running. Skip.");
        return;
    }

    crawlerRunning = true;
    lastCrawlerStart = new Date().toISOString();
    lastCrawlerError = null;

    console.log("[CRAWLER] Automatic crawl started.");

    try {
        await crawl();

        lastCrawlerFinish = new Date().toISOString();

        console.log("[CRAWLER] Automatic crawl finished.");

    } catch (error) {
        lastCrawlerError = error.message;

        console.error("[CRAWLER ERROR]", error);

    } finally {
        crawlerRunning = false;
    }
}

app.get("/api/crawler", (req, res) => {
    res.json({
        enabled: true,
        running: crawlerRunning,
        lastStart: lastCrawlerStart,
        lastFinish: lastCrawlerFinish,
        lastError: lastCrawlerError
    });
});

// ========================================
// 사용자 URL 크롤링 큐
// ========================================

app.post("/api/crawl/queue", async (req, res) => {
    try {
        let { url } = req.body;

        if (!url || typeof url !== "string") {
            return res.status(400).json({
                ok: false,
                error: "URL을 입력하세요."
            });
        }

        url = url.trim();

        if (!/^https?:\/\//i.test(url)) {
            url = "https://" + url;
        }

        let parsed;

        try {
            parsed = new URL(url);
        } catch {
            return res.status(400).json({
                ok: false,
                error: "올바른 URL이 아닙니다."
            });
        }

        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return res.status(400).json({
                ok: false,
                error: "HTTP 또는 HTTPS 주소만 사용할 수 있습니다."
            });
        }

        if (parsed.username || parsed.password) {
            return res.status(400).json({
                ok: false,
                error: "사용자명 또는 비밀번호가 포함된 URL은 사용할 수 없습니다."
            });
        }

        parsed.hash = "";

        if (
            (parsed.protocol === "http:" && parsed.port === "80") ||
            (parsed.protocol === "https:" && parsed.port === "443")
        ) {
            parsed.port = "";
        }

        url = parsed.href;

        const existing = await pool.query(
            `
            SELECT url
            FROM pages
            WHERE url = $1
            LIMIT 1
            `,
            [url]
        );

        if (existing.rows.length > 0) {
            return res.json({
                ok: true,
                queued: false,
                alreadyIndexed: true,
                url
            });
        }

        const result = await pool.query(
            `
            INSERT INTO crawl_queue (
                url,
                status
            )
            VALUES (
                $1,
                'pending'
            )
            ON CONFLICT (url)
            DO UPDATE SET
                status = 'pending',
                last_error = NULL,
                finished_at = NULL
            RETURNING *
            `,
            [url]
        );

        console.log("[CRAWL QUEUE] Added:", url);

        setTimeout(() => {
            runCrawler().catch(error => {
                console.error(
                    "[QUEUE CRAWLER ERROR]",
                    error
                );
            });
        }, 100);

        return res.json({
            ok: true,
            queued: true,
            url,
            queue: result.rows[0]
        });

    } catch (error) {
        console.error("[CRAWL QUEUE ERROR]", error);

        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.get("/api/crawl/queue", async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT
                id,
                url,
                status,
                attempts,
                added_at,
                started_at,
                finished_at,
                last_error
            FROM crawl_queue
            ORDER BY added_at DESC
            LIMIT 100
            `
        );

        res.json({
            ok: true,
            count: result.rows.length,
            queue: result.rows
        });

    } catch (error) {
        console.error(
            "[CRAWL QUEUE GET ERROR]",
            error
        );

        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

// ========================================
// OSmail API
// 반드시 app.listen()보다 먼저 등록
// ========================================

// ----------------------------------------
// 현재 로그인한 사용자의 OSmail 정보
// ----------------------------------------

app.get("/api/osmail/me", async (req, res) => {
    try {
        const result = await getMyOSmail(req);

        return res.json({
            ok: true,
            ...result
        });

    } catch (error) {
        console.error("[OSMAIL ME ERROR]", error);

        return res.status(401).json({
            ok: false,
            error: error.message || "로그인이 필요합니다."
        });
    }
});

// ----------------------------------------
// OSmail ID 생성
// ----------------------------------------

app.post("/api/osmail/profile", async (req, res) => {
    try {
        const {
            osmailId,
            displayName
        } = req.body;

        if (!osmailId) {
            return res.status(400).json({
                ok: false,
                error: "OSmail ID를 입력하세요."
            });
        }

        const result = await createOSmailProfile(
            req,
            osmailId,
            displayName
        );

        return res.json({
            ok: true,
            ...result
        });

    } catch (error) {
        console.error(
            "[OSMAIL PROFILE ERROR]",
            error
        );

        return res.status(400).json({
            ok: false,
            error: error.message
        });
    }
});

// ----------------------------------------
// 메일 목록
// ----------------------------------------

app.get("/api/osmail/emails", async (req, res) => {
    try {
        const emails = await getEmails(req);

        return res.json({
            ok: true,
            emails
        });

    } catch (error) {
        console.error(
            "[OSMAIL EMAILS ERROR]",
            error
        );

        return res.status(401).json({
            ok: false,
            error: error.message
        });
    }
});

// ----------------------------------------
// OSmail 내부 메일
// ----------------------------------------

app.post("/api/osmail/send-internal", async (req, res) => {
    try {
        const {
            to,
            subject,
            body
        } = req.body;

        if (!to) {
            return res.status(400).json({
                ok: false,
                error: "받는 사람을 입력하세요."
            });
        }

        const email = await sendInternalMail(req, {
            to,
            subject: subject || "",
            body: body || ""
        });

        return res.json({
            ok: true,
            email
        });

    } catch (error) {
        console.error(
            "[OSMAIL INTERNAL SEND ERROR]",
            error
        );

        return res.status(400).json({
            ok: false,
            error: error.message
        });
    }
});

// ----------------------------------------
// 외부 이메일
// ----------------------------------------

app.post("/api/osmail/send-external", async (req, res) => {
    try {
        const {
            to,
            subject,
            body
        } = req.body;

        if (!to) {
            return res.status(400).json({
                ok: false,
                error: "받는 사람을 입력하세요."
            });
        }

        const result = await sendExternalMail(req, {
            to,
            subject: subject || "",
            body: body || ""
        });

        return res.json({
            ok: true,
            ...result
        });

    } catch (error) {
        console.error(
            "[OSMAIL EXTERNAL SEND ERROR]",
            error
        );

        return res.status(400).json({
            ok: false,
            error: error.message
        });
    }
});

// ----------------------------------------
// 읽음 처리
// ----------------------------------------

app.post("/api/osmail/read", async (req, res) => {
    try {
        if (!req.body.id) {
            return res.status(400).json({
                ok: false,
                error: "메일 ID가 필요합니다."
            });
        }

        const email = await markAsRead(
            req,
            req.body.id
        );

        return res.json({
            ok: true,
            email
        });

    } catch (error) {
        console.error(
            "[OSMAIL READ ERROR]",
            error
        );

        return res.status(400).json({
            ok: false,
            error: error.message
        });
    }
});

// ----------------------------------------
// 삭제
// ----------------------------------------

app.post("/api/osmail/delete", async (req, res) => {
    try {
        if (!req.body.id) {
            return res.status(400).json({
                ok: false,
                error: "메일 ID가 필요합니다."
            });
        }

        const email = await deleteEmail(
            req,
            req.body.id
        );

        return res.json({
            ok: true,
            email
        });

    } catch (error) {
        console.error(
            "[OSMAIL DELETE ERROR]",
            error
        );

        return res.status(400).json({
            ok: false,
            error: error.message
        });
    }
});

// ----------------------------------------
// 복구
// ----------------------------------------

app.post("/api/osmail/restore", async (req, res) => {
    try {
        if (!req.body.id) {
            return res.status(400).json({
                ok: false,
                error: "메일 ID가 필요합니다."
            });
        }

        const email = await restoreEmail(
            req,
            req.body.id
        );

        return res.json({
            ok: true,
            email
        });

    } catch (error) {
        console.error(
            "[OSMAIL RESTORE ERROR]",
            error
        );

        return res.status(400).json({
            ok: false,
            error: error.message
        });
    }
});

// ----------------------------------------
// SMTP 상태 확인
// ----------------------------------------

app.get("/api/osmail/test", async (req, res) => {
    try {
        const ok = await verifySMTP();

        return res.json({
            ok,
            service: "OSmail SMTP"
        });

    } catch (error) {
        console.error(
            "[OSMAIL SMTP TEST ERROR]",
            error
        );

        return res.status(500).json({
            ok: false,
            service: "OSmail SMTP",
            error: error.message
        });
    }
});

// ========================================
// public 파일
// ========================================

app.use(
    express.static(
        path.join(__dirname, "../public")
    )
);

// ========================================
// 기본 페이지
// ========================================

app.get("/", (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "../public/oscadia.html"
        )
    );
});

// ========================================
// 존재하지 않는 API 처리
// ========================================

app.use("/api", (req, res) => {
    res.status(404).json({
        ok: false,
        error: "API endpoint not found",
        path: req.path
    });
});

// ========================================
// 서버 시작
// app.listen은 반드시 마지막
// ========================================

async function startServer() {
    try {
        await verifySMTP();
    } catch (error) {
        console.error(
            "[SMTP STARTUP ERROR]",
            error
        );
    }

    app.listen(PORT, () => {
        console.log(
            `OSCADIA running on port ${PORT}`
        );

        console.log(
            `OSmail API: /api/osmail/me`
        );

        // 서버 시작 5초 후 크롤링
        setTimeout(() => {
            runCrawler().catch(error => {
                console.error(
                    "[STARTUP CRAWLER ERROR]",
                    error
                );
            });
        }, 5000);

        // 30분마다 자동 크롤링
        setInterval(() => {
            runCrawler().catch(error => {
                console.error(
                    "[INTERVAL CRAWLER ERROR]",
                    error
                );
            });
        }, 30 * 60 * 1000);
    });
}

startServer();