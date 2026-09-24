import "dotenv/config";
import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { crawl } from "./crawler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());


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

    // Google
    "구글": [
        "google",
        "google.com",
        "www.google.com"
    ],

    "google": [
        "google",
        "google.com",
        "www.google.com"
    ],


    // Naver
    "네이버": [
        "naver",
        "naver.com",
        "www.naver.com"
    ],

    "naver": [
        "naver",
        "naver.com",
        "www.naver.com"
    ],


    // Daum
    "다음": [
        "daum",
        "daum.net",
        "www.daum.net"
    ],

    "daum": [
        "daum",
        "daum.net",
        "www.daum.net"
    ],


    // YouTube
    "유튜브": [
        "youtube",
        "youtube.com",
        "www.youtube.com"
    ],

    "youtube": [
        "youtube",
        "youtube.com",
        "www.youtube.com"
    ],


    // GitHub
    "깃허브": [
        "github",
        "github.com",
        "www.github.com"
    ],

    "github": [
        "github",
        "github.com",
        "www.github.com"
    ],


    // Wikipedia
    "위키백과": [
        "wikipedia",
        "wikipedia.org",
        "www.wikipedia.org"
    ],

    "위키피디아": [
        "wikipedia",
        "wikipedia.org",
        "www.wikipedia.org"
    ],

    "wikipedia": [
        "wikipedia",
        "wikipedia.org",
        "www.wikipedia.org"
    ],


    // Mozilla
    "모질라": [
        "mozilla",
        "mozilla.org",
        "www.mozilla.org"
    ],

    "mozilla": [
        "mozilla",
        "mozilla.org",
        "www.mozilla.org"
    ],


    // NASA
    "나사": [
        "nasa",
        "nasa.gov",
        "www.nasa.gov"
    ],

    "nasa": [
        "nasa",
        "nasa.gov",
        "www.nasa.gov"
    ],


    // Amazon
    "아마존": [
        "amazon",
        "amazon.com",
        "www.amazon.com"
    ],

    "amazon": [
        "amazon",
        "amazon.com",
        "www.amazon.com"
    ],


    // BBC
    "비비씨": [
        "bbc",
        "bbc.com",
        "www.bbc.com"
    ],

    "bbc": [
        "bbc",
        "bbc.com",
        "www.bbc.com"
    ],


    // CNN
    "씨엔엔": [
        "cnn",
        "cnn.com",
        "www.cnn.com"
    ],

    "cnn": [
        "cnn",
        "cnn.com",
        "www.cnn.com"
    ],


    // Reddit
    "레딧": [
        "reddit",
        "reddit.com",
        "www.reddit.com"
    ],

    "reddit": [
        "reddit",
        "reddit.com",
        "www.reddit.com"
    ],


    // Stack Overflow
    "스택오버플로": [
        "stackoverflow",
        "stackoverflow.com"
    ],

    "스택오버플로우": [
        "stackoverflow",
        "stackoverflow.com"
    ],

    "stackoverflow": [
        "stackoverflow",
        "stackoverflow.com"
    ],


    // New York Times
    "뉴욕타임스": [
        "nytimes",
        "nytimes.com",
        "www.nytimes.com"
    ],

    "뉴욕 타임스": [
        "nytimes",
        "nytimes.com",
        "www.nytimes.com"
    ],

    "nytimes": [
        "nytimes",
        "nytimes.com",
        "www.nytimes.com"
    ],


    // The Guardian
    "가디언": [
        "guardian",
        "theguardian.com",
        "www.theguardian.com"
    ],

    "guardian": [
        "guardian",
        "theguardian.com",
        "www.theguardian.com"
    ],


    // Britannica
    "브리태니커": [
        "britannica",
        "britannica.com",
        "www.britannica.com"
    ],

    "britannica": [
        "britannica",
        "britannica.com",
        "www.britannica.com"
    ],


    // Internet Archive
    "인터넷 아카이브": [
        "archive",
        "archive.org",
        "www.archive.org"
    ],

    "인터넷아카이브": [
        "archive",
        "archive.org",
        "www.archive.org"
    ],

    "archive": [
        "archive",
        "archive.org",
        "www.archive.org"
    ],


    // W3C
    "w3c": [
        "w3c",
        "w3.org",
        "www.w3.org"
    ],

    "월드와이드웹컨소시엄": [
        "w3c",
        "w3.org",
        "www.w3.org"
    ],


    // Python
    "파이썬": [
        "python",
        "python.org",
        "www.python.org"
    ],

    "python": [
        "python",
        "python.org",
        "www.python.org"
    ],


    // NamuWiki
    "나무위키": [
        "namu",
        "namu.wiki",
        "www.namu.wiki"
    ],

    "namuwiki": [
        "namu",
        "namu.wiki",
        "www.namu.wiki"
    ]
};


// ========================================
// 일반적인 관련 검색어
//
// crawler가 저장한 keywords와 함께 사용.
// 모든 사이트를 직접 지정하는 방식이 아니라
// 검색 개념을 넓혀주는 용도.
// ========================================

const RELATED_TERMS = {

    "검색": [
        "search",
        "검색엔진",
        "search engine",
        "웹검색",
        "web search",
        "find information"
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
        "신문",
        "뉴스"
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
// 검색어 정리
// ========================================

function normalizeSearchQuery(query) {

    return String(query || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}


// ========================================
// 검색어 분리
// ========================================

function tokenizeQuery(query) {

    return normalizeSearchQuery(query)
        .split(/[\s,./!?()[\]{}:;|]+/)
        .map(word => word.trim())
        .filter(word => word.length >= 1);
}


// ========================================
// 검색용 키워드 만들기
// ========================================

function getSearchTerms(query) {

    const normalized =
        normalizeSearchQuery(query);

    const terms = new Set();

    if (normalized) {
        terms.add(normalized);
    }


    // 공백으로 나뉜 개별 단어
    for (const token of tokenizeQuery(normalized)) {
        terms.add(token);
    }


    // 별칭
    const aliases =
        SEARCH_ALIASES[normalized];

    if (aliases) {

        for (const alias of aliases) {
            terms.add(alias.toLowerCase());
        }
    }


    // 관련 검색어
    const related =
        RELATED_TERMS[normalized];

    if (related) {

        for (const term of related) {
            terms.add(term.toLowerCase());
        }
    }


    return [...terms];
}


// ========================================
// URL에서 도메인 추출
// ========================================

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
// 검색어를 PostgreSQL 검색어로 안전하게 변환
// ========================================

function safeTsQuery(term) {

    return String(term || "")
        .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
        .trim();
}


// ========================================
// 검색 API
// ========================================

app.get("/api/search", async (req, res) => {

    const originalQuery =
        String(req.query.q || "").trim();


    if (!originalQuery) {

        return res.json({
            ok: true,
            count: 0,
            results: []
        });
    }


    const query =
        normalizeSearchQuery(originalQuery);


    const terms =
        getSearchTerms(query);


    try {

        // ====================================
        // 검색어가 너무 많아지는 것 방지
        // ====================================

        const limitedTerms =
            terms.slice(0, 30);


        // ====================================
        // PostgreSQL 검색 조건
        //
        // title
        // description
        // keywords
        // content
        // URL
        // domain
        // 모두 검색
        // ====================================

        const searchConditions =
            limitedTerms.map((term, index) => {

                const parameter =
                    `$${index + 1}`;

                return `
                    (
                        LOWER(COALESCE(title, ''))
                            LIKE '%' || LOWER(${parameter}) || '%'

                        OR

                        LOWER(COALESCE(description, ''))
                            LIKE '%' || LOWER(${parameter}) || '%'

                        OR

                        LOWER(COALESCE(keywords, ''))
                            LIKE '%' || LOWER(${parameter}) || '%'

                        OR

                        LOWER(COALESCE(content, ''))
                            LIKE '%' || LOWER(${parameter}) || '%'

                        OR

                        LOWER(COALESCE(url, ''))
                            LIKE '%' || LOWER(${parameter}) || '%'

                        OR

                        LOWER(COALESCE(domain, ''))
                            LIKE '%' || LOWER(${parameter}) || '%'
                    )
                `;
            });


        const values =
            limitedTerms;


        // ====================================
        // 검색어별 점수 계산
        //
        // 제목        매우 높음
        // keywords    높음
        // 설명        높음
        // domain      높음
        // URL         중간
        // content     낮음
        // ====================================

        const scoreParts =
            limitedTerms.map((term, index) => {

                const parameter =
                    `$${index + 1}`;

                return `
                    (
                        CASE
                            WHEN LOWER(COALESCE(title, ''))
                                LIKE '%' || LOWER(${parameter}) || '%'
                            THEN 100
                            ELSE 0
                        END

                        +

                        CASE
                            WHEN LOWER(COALESCE(keywords, ''))
                                LIKE '%' || LOWER(${parameter}) || '%'
                            THEN 60
                            ELSE 0
                        END

                        +

                        CASE
                            WHEN LOWER(COALESCE(description, ''))
                                LIKE '%' || LOWER(${parameter}) || '%'
                            THEN 45
                            ELSE 0
                        END

                        +

                        CASE
                            WHEN LOWER(COALESCE(domain, ''))
                                LIKE '%' || LOWER(${parameter}) || '%'
                            THEN 40
                            ELSE 0
                        END

                        +

                        CASE
                            WHEN LOWER(COALESCE(url, ''))
                                LIKE '%' || LOWER(${parameter}) || '%'
                            THEN 30
                            ELSE 0
                        END

                        +

                        CASE
                            WHEN LOWER(COALESCE(content, ''))
                                LIKE '%' || LOWER(${parameter}) || '%'
                            THEN 10
                            ELSE 0
                        END
                    )
                `;
            });


        // ====================================
        // PostgreSQL Full Text Search 점수
        // ====================================

        const tsRankParts =
            limitedTerms
                .map((term, index) => {

                    const parameter =
                        `$${index + 1}`;

                    const tsTerm =
                        safeTsQuery(term);

                    if (!tsTerm) {
                        return "0";
                    }

                    return `
                        ts_rank_cd(
                            to_tsvector(
                                'simple',
                                COALESCE(title, '') || ' ' ||
                                COALESCE(description, '') || ' ' ||
                                COALESCE(keywords, '') || ' ' ||
                                COALESCE(content, '')
                            ),
                            plainto_tsquery(
                                'simple',
                                ${parameter}
                            )
                        ) * 100
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

                (

                    ${scoreParts.join(" + ")}

                    +

                    (${tsRankParts.join(" + ")})

                ) AS relevance_score

            FROM pages

            WHERE

                ${searchConditions.join(" OR ")}

            ORDER BY

                relevance_score DESC,

                last_crawled DESC

            LIMIT 50
        `;


        const result =
            await pool.query(
                sql,
                values
            );


        // ====================================
        // 추가적인 결과 점수 보정
        // ====================================

        const results =
            result.rows.map(row => {

                const domain =
                    String(row.domain || "")
                        .toLowerCase();

                const url =
                    String(row.url || "")
                        .toLowerCase();

                const title =
                    String(row.title || "")
                        .toLowerCase();

                const description =
                    String(row.description || "")
                        .toLowerCase();

                const keywords =
                    String(row.keywords || "")
                        .toLowerCase();


                let score =
                    Number(
                        row.relevance_score || 0
                    );


                // ==================================
                // 검색어 전체가 제목에 정확히 있으면
                // 추가 점수
                // ==================================

                if (
                    title.includes(query)
                ) {
                    score += 250;
                }


                // ==================================
                // 검색어 전체가 keywords에 있으면
                // 추가 점수
                // ==================================

                if (
                    keywords.includes(query)
                ) {
                    score += 150;
                }


                // ==================================
                // 설명에 검색어 전체가 있으면
                // ==================================

                if (
                    description.includes(query)
                ) {
                    score += 100;
                }


                // ==================================
                // 별칭 직접 일치
                // ==================================

                let aliasMatch = false;

                const aliases =
                    SEARCH_ALIASES[query];


                if (aliases) {

                    aliasMatch =
                        aliases.some(alias => {

                            const a =
                                alias.toLowerCase();

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


                // ==================================
                // 관련 검색어가 실제 keywords에
                // 존재하는 경우 추가 점수
                // ==================================

                const related =
                    RELATED_TERMS[query];


                let relatedMatch = false;


                if (related) {

                    relatedMatch =
                        related.some(term => {

                            return (
                                keywords.includes(
                                    term.toLowerCase()
                                ) ||

                                title.includes(
                                    term.toLowerCase()
                                ) ||

                                description.includes(
                                    term.toLowerCase()
                                ) ||

                                String(row.content || "")
                                    .toLowerCase()
                                    .includes(
                                        term.toLowerCase()
                                    )
                            );
                        });


                    if (relatedMatch) {
                        score += 180;
                    }
                }


                return {

                    id: row.id,

                    url: row.url,

                    title:
                        row.title ||
                        "제목 없음",

                    description:
                        row.description ||
                        "",

                    domain:
                        row.domain ||
                        getDomainFromUrl(
                            row.url
                        ),

                    keywords:
                        row.keywords ||
                        "",

                    last_crawled:
                        row.last_crawled,

                    rank:
                        score,

                    alias_match:
                        aliasMatch,

                    related_match:
                        relatedMatch
                };
            });


        // ====================================
        // 최종 정렬
        // ====================================

        results.sort((a, b) => {

            // 직접 별칭 일치
            if (
                a.alias_match &&
                !b.alias_match
            ) {
                return -1;
            }

            if (
                !a.alias_match &&
                b.alias_match
            ) {
                return 1;
            }


            // 관련 검색어 일치
            if (
                a.related_match &&
                !b.related_match
            ) {
                return -1;
            }

            if (
                !a.related_match &&
                b.related_match
            ) {
                return 1;
            }


            return (
                Number(b.rank || 0) -
                Number(a.rank || 0)
            );
        });


        // ====================================
        // 중복 URL 제거
        // ====================================

        const uniqueResults = [];

        const seenUrls =
            new Set();


        for (const result of results) {

            const normalizedUrl =
                String(result.url || "")
                    .toLowerCase()
                    .replace(/\/+$/, "");


            if (
                seenUrls.has(normalizedUrl)
            ) {
                continue;
            }


            seenUrls.add(
                normalizedUrl
            );


            uniqueResults.push(
                result
            );


            if (
                uniqueResults.length >= 50
            ) {
                break;
            }
        }


        // ====================================
        // 응답
        // ====================================

        return res.json({

            ok: true,

            query: originalQuery,

            searchTerms:
                limitedTerms,

            count:
                uniqueResults.length,

            results:
                uniqueResults
        });


    } catch (error) {

        console.error(
            "SEARCH ERROR"
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


        return res.status(500).json({

            ok: false,

            error:
                "검색 중 오류가 발생했습니다."
        });
    }
});


// ========================================
// Health Check
// ========================================

app.get(
    "/api/health",
    async (req, res) => {

        try {

            await pool.query(
                "SELECT 1"
            );


            res.json({

                ok: true,

                database:
                    "connected",

                crawler:
                    "enabled"
            });


        } catch (error) {

            res.status(500).json({

                ok: false,

                database:
                    "disconnected",

                error:
                    error.message
            });
        }
    }
);


// ========================================
// Crawler 실행
// ========================================

async function runCrawler() {

    if (crawlerRunning) {

        console.log(
            "[CRAWLER] Already running. Skip."
        );

        return;
    }


    crawlerRunning = true;

    lastCrawlerStart =
        new Date().toISOString();

    lastCrawlerError = null;


    console.log(
        "[CRAWLER] Automatic crawl started."
    );


    try {

        await crawl();


        lastCrawlerFinish =
            new Date().toISOString();


        console.log(
            "[CRAWLER] Automatic crawl finished."
        );


    } catch (error) {

        lastCrawlerError =
            error.message;


        console.error(
            "[CRAWLER ERROR]",
            error
        );


    } finally {

        crawlerRunning = false;
    }
}


// ========================================
// Crawler 상태
// ========================================

app.get(
    "/api/crawler",
    (req, res) => {

        res.json({

            enabled: true,

            running:
                crawlerRunning,

            lastStart:
                lastCrawlerStart,

            lastFinish:
                lastCrawlerFinish,

            lastError:
                lastCrawlerError
        });
    }
);


// ========================================
// OSCADIA 홈페이지
// ========================================

// public 폴더 안의 CSS, JS, 이미지 등 정적 파일 제공
app.use(
    express.static(
        path.join(__dirname, "../public")
    )
);

// 기본 주소 → public/oscadia.html
app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "../public/oscadia.html"
            )
        );
    }
);


// ========================================
// 서버 시작
// ========================================

app.listen(
    PORT,
    () => {

        console.log(
            `OSCADIA running on port ${PORT}`
        );


        // 서버 시작 5초 후 첫 크롤링
        setTimeout(() => {

            runCrawler();

        }, 5000);


        // 30분마다 자동 크롤링
        setInterval(() => {

            runCrawler();

        }, 30 * 60 * 1000);

    }
);